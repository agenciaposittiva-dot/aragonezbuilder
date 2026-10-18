import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { APP_NAME } from "@/lib/constants";
import { INVITE_VALIDITY, invitationInput } from "@/lib/validators/team";
import { withOrg, withSystem } from "@/server/db";
import {
  auditLogs,
  clientAccess,
  clients,
  domainEvents,
  emailOutbox,
  invitations,
  memberships,
  organizations,
  roles,
  user,
} from "@/server/db/schema";
import { eachInSequence } from "@/server/db/sequence";
import { assertCan, assertInternal, type Scope } from "@/server/authz";
import { env } from "@/server/env";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { emailConfigured, emailDeliveryState, enqueueEmail, renderEmail, type EmailDeliveryState } from "@/server/mail";
import { recordActivity } from "./activity";

const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

export function inviteUrl(token: string) {
  return `${env.APP_URL.replace(/\/$/, "")}/invite/${token}`;
}

async function sendInviteEmail(
  s: Scope,
  opts: { email: string; token: string; roleName: string; kind: "internal" | "client"; validityDays: number },
) {
  const { html, text } = renderEmail({
    title: `Convite para ${s.actor.orgName}`,
    paragraphs: [
      `${s.actor.name} convidou você para ${opts.kind === "client" ? "a área do cliente de" : "a equipe de"} ${s.actor.orgName} no ${APP_NAME}, com o papel ${opts.roleName}.`,
      `O convite vale por ${opts.validityDays} ${opts.validityDays === 1 ? "dia" : "dias"} e só pode ser usado uma vez. Use o mesmo e-mail que recebeu esta mensagem.`,
    ],
    action: { label: "Aceitar convite", url: inviteUrl(opts.token) },
  });
  await enqueueEmail({ to: opts.email, subject: `Convite: ${s.actor.orgName} · ${APP_NAME}`, html, text }, s.db);
}

/** Resultado entregue a quem convidou: o link (para copiar) e o estado real do e-mail. */
export type InvitationIssued = { id: string; url: string; email: EmailDeliveryState };

/**
 * Emite o convite (token aleatório de uso único; no banco só o hash) e coloca
 * o e-mail na fila. As checagens de quem pode convidar quem ficam com quem chama.
 */
export async function issueInvitation(
  s: Scope,
  opts: {
    email: string;
    name: string | null;
    role: typeof roles.$inferSelect;
    clientIds: string[];
    validityDays: number;
  },
): Promise<InvitationIssued> {
  // Um convite pendente por e-mail: os anteriores são revogados.
  await s.db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.email, opts.email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));

  const token = newToken();
  const [row] = await s.db
    .insert(invitations)
    .values({
      organizationId: s.actor.orgId,
      email: opts.email,
      name: opts.name,
      roleId: opts.role.id,
      clientIds: opts.role.kind === "client" ? opts.clientIds : [],
      tokenHash: hashToken(token),
      invitedByUserId: s.actor.userId,
      expiresAt: new Date(Date.now() + opts.validityDays * DAY_MS),
    })
    .returning({ id: invitations.id });

  await sendInviteEmail(s, {
    email: opts.email,
    token,
    roleName: opts.role.name,
    kind: opts.role.kind,
    validityDays: opts.validityDays,
  });
  await recordActivity(s, {
    action: "invited",
    entityType: "invitation",
    entityId: row!.id,
    summary: `Convite criado para ${opts.email} (${opts.role.name})`,
    event: {
      type: "member.invited",
      payload: { invitationId: row!.id, email: opts.email, roleKey: opts.role.key, clientIds: opts.clientIds },
    },
  });
  // O token só sai daqui para quem convidou (para copiar o link); no banco fica só o hash.
  return { id: row!.id, url: inviteUrl(token), email: emailConfigured() ? "queued" : "not_configured" };
}

/** Recusa convites para quem já tem acesso ativo à organização. */
export async function assertNotActiveMember(s: Scope, email: string) {
  const [existing] = await s.db
    .select({ status: memberships.status })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(sql`lower(${user.email}) = ${email}`);
  if (existing && existing.status === "active") throw new ConflictError("Esta pessoa já faz parte da organização.");
}

export async function createInvitation(s: Scope, raw: z.input<typeof invitationInput>): Promise<InvitationIssued> {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  const data = invitationInput.parse(raw);
  const [role] = await s.db.select().from(roles).where(eq(roles.id, data.roleId));
  if (!role) throw new ValidationError("Papel inválido.", { roleId: ["Selecione um papel"] });
  if (role.key === "owner" && s.actor.roleKey !== "owner") {
    throw new ForbiddenError("Só um proprietário pode convidar outro proprietário.");
  }

  const clientIds = [...new Set(data.clientIds)];
  if (role.kind === "client") {
    if (!clientIds.length)
      throw new ValidationError("Selecione o(s) cliente(s) que a pessoa poderá acessar.", {
        clientIds: ["Obrigatório para usuários de cliente"],
      });
    const found = await s.db
      .select({ id: clients.id })
      .from(clients)
      .where(and(inArray(clients.id, clientIds), isNull(clients.archivedAt), isNull(clients.deletedAt)));
    if (found.length !== clientIds.length) throw new ValidationError("Um dos clientes selecionados é inválido.");
  }

  await assertNotActiveMember(s, data.email);
  return issueInvitation(s, { email: data.email, name: data.name, role, clientIds, validityDays: data.validityDays });
}

/**
 * Estado real do último e-mail de convite de cada pessoa (fila de e-mails).
 * A fila não guarda o id do convite: usa o e-mail mais recente com assunto de
 * convite enviado ao endereço depois da criação do convite.
 */
export async function inviteEmailStates(s: Scope, invites: { email: string; createdAt: Date }[]) {
  const out = new Map<string, EmailDeliveryState>();
  if (!invites.length) return out;
  const rows = await s.db
    .select({
      to: emailOutbox.to,
      sentAt: emailOutbox.sentAt,
      lastError: emailOutbox.lastError,
      attempts: emailOutbox.attempts,
      createdAt: emailOutbox.createdAt,
    })
    .from(emailOutbox)
    .where(
      and(inArray(emailOutbox.to, [...new Set(invites.map((i) => i.email))]), like(emailOutbox.subject, "Convite:%")),
    )
    .orderBy(desc(emailOutbox.createdAt));
  for (const inv of invites) {
    const mail = rows.find((r) => r.to === inv.email && r.createdAt.getTime() >= inv.createdAt.getTime() - 5000);
    out.set(`${inv.email}|${inv.createdAt.getTime()}`, mail ? emailDeliveryState(mail) : "not_configured");
  }
  return out;
}

export const inviteKey = (i: { email: string; createdAt: Date }) => `${i.email}|${i.createdAt.getTime()}`;

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Convites da agência por situação: pendentes (válidos), aceitos, expirados
 * (não usados dentro da validade) ou revogados. Mostra agência, papel e, para
 * usuários de cliente, os clientes liberados.
 */
export async function listInvitations(s: Scope, status: InvitationStatus = "pending") {
  assertInternal(s.actor);
  assertCan(s.actor, "members.read");
  const now = new Date();
  const where =
    status === "accepted"
      ? isNotNull(invitations.acceptedAt)
      : status === "revoked"
        ? and(isNull(invitations.acceptedAt), isNotNull(invitations.revokedAt))
        : status === "expired"
          ? and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), lte(invitations.expiresAt, now))
          : and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, now));
  const rows = await s.db
    .select({
      id: invitations.id,
      email: invitations.email,
      name: invitations.name,
      roleName: roles.name,
      roleKind: roles.kind,
      clientIds: invitations.clientIds,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
      acceptedAt: invitations.acceptedAt,
      revokedAt: invitations.revokedAt,
      invitedBy: user.name,
    })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .leftJoin(user, eq(user.id, invitations.invitedByUserId))
    .where(where)
    .orderBy(status === "pending" ? asc(invitations.createdAt) : desc(invitations.createdAt))
    .limit(200);
  const clientIds = [...new Set(rows.flatMap((r) => r.clientIds))];
  const clientNames = new Map(
    clientIds.length
      ? (
          await s.db.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds))
        ).map((c) => [c.id, c.name])
      : [],
  );
  const states = status === "pending" || status === "expired" ? await inviteEmailStates(s, rows) : new Map();
  return rows.map((r) => ({
    ...r,
    status,
    orgName: s.actor.orgName,
    clientNames: r.clientIds.map((id) => clientNames.get(id) ?? "Cliente removido"),
    expired: status === "expired",
    emailState: states.get(inviteKey(r)) ?? ("not_configured" as const),
  }));
}

/** Quantidade de convites por situação (abas da área de convites). */
export async function invitationCounts(s: Scope): Promise<Record<InvitationStatus, number>> {
  assertInternal(s.actor);
  assertCan(s.actor, "members.read");
  const now = new Date();
  const [row] = await s.db
    .select({
      pending: sql<number>`count(*) filter (where ${invitations.acceptedAt} is null and ${invitations.revokedAt} is null and ${invitations.expiresAt} > ${now})::int`,
      accepted: sql<number>`count(*) filter (where ${invitations.acceptedAt} is not null)::int`,
      expired: sql<number>`count(*) filter (where ${invitations.acceptedAt} is null and ${invitations.revokedAt} is null and ${invitations.expiresAt} <= ${now})::int`,
      revoked: sql<number>`count(*) filter (where ${invitations.acceptedAt} is null and ${invitations.revokedAt} is not null)::int`,
    })
    .from(invitations);
  return {
    pending: row?.pending ?? 0,
    accepted: row?.accepted ?? 0,
    expired: row?.expired ?? 0,
    revoked: row?.revoked ?? 0,
  };
}

export async function revokeInvitation(s: Scope, id: string) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  const [row] = await s.db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
    .returning({ email: invitations.email });
  if (!row) throw new NotFoundError("Convite não encontrado ou já utilizado.");
  await recordActivity(s, {
    action: "revoked",
    entityType: "invitation",
    entityId: id,
    summary: `Convite para ${row.email} revogado`,
    event: false,
  });
}

/** Gera um novo link (o anterior deixa de funcionar) e renova a validade. */
export async function resendInvitation(s: Scope, id: string, validityDays: number = INVITE_VALIDITY.default) {
  assertInternal(s.actor);
  assertCan(s.actor, "members.manage");
  return reissueInvitation(s, id, validityDays);
}

/** Novo token de uso único e nova validade para um convite pendente (checagens com quem chama). */
export async function reissueInvitation(s: Scope, id: string, validityDays: number): Promise<InvitationIssued> {
  const days = Math.min(INVITE_VALIDITY.max, Math.max(INVITE_VALIDITY.min, Math.round(validityDays)));
  const [inv] = await s.db
    .select({ invitation: invitations, role: roles })
    .from(invitations)
    .innerJoin(roles, eq(roles.id, invitations.roleId))
    .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  if (!inv) throw new NotFoundError("Convite não encontrado ou já utilizado.");
  const token = newToken();
  await s.db
    .update(invitations)
    .set({ tokenHash: hashToken(token), expiresAt: new Date(Date.now() + days * DAY_MS) })
    .where(eq(invitations.id, id));
  await sendInviteEmail(s, {
    email: inv.invitation.email,
    token,
    roleName: inv.role.name,
    kind: inv.role.kind,
    validityDays: days,
  });
  await recordActivity(s, {
    action: "resent",
    entityType: "invitation",
    entityId: id,
    summary: `Convite reenviado para ${inv.invitation.email}`,
    event: false,
  });
  return { id, url: inviteUrl(token), email: emailConfigured() ? "queued" : "not_configured" };
}

/* ------------------------------------------------------------------ */
/* Aceite (fora do contexto de organização)                            */
/* ------------------------------------------------------------------ */

export type InvitationPreview = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  email: string;
  roleName: string;
  roleKind: "internal" | "client";
  state: "valid" | "expired" | "revoked" | "accepted";
  userExists: boolean;
};

/** Busca o convite pelo token (somente o hash é comparado). */
export async function getInvitationByToken(token: string): Promise<InvitationPreview | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  return withSystem(async (tx) => {
    const [row] = await tx
      .select({ invitation: invitations, org: organizations, role: roles })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .where(and(eq(invitations.tokenHash, hashToken(token)), isNull(organizations.deletedAt)))
      .limit(1);
    if (!row) return null;
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${row.invitation.email.toLowerCase()}`)
      .limit(1);
    const inv = row.invitation;
    const state = inv.acceptedAt
      ? "accepted"
      : inv.revokedAt
        ? "revoked"
        : inv.expiresAt.getTime() < Date.now()
          ? "expired"
          : "valid";
    return {
      id: inv.id,
      orgId: row.org.id,
      orgName: row.org.name,
      orgSlug: row.org.slug,
      email: inv.email,
      roleName: row.role.name,
      roleKind: row.role.kind,
      state,
      userExists: !!existing,
    };
  });
}

const STATE_MESSAGE = {
  expired: "Este convite expirou. Peça um novo convite a quem enviou.",
  revoked: "Este convite foi cancelado.",
  accepted: "Este convite já foi utilizado.",
} as const;

/**
 * Aceita o convite em nome do usuário logado. O e-mail da conta precisa ser o
 * mesmo do convite (comparação sem diferenciar maiúsculas).
 */
export async function acceptInvitation(token: string, sessionUser: { id: string; email: string }) {
  const preview = await getInvitationByToken(token);
  if (!preview) throw new NotFoundError("Convite não encontrado.");
  if (preview.state !== "valid") throw new ValidationError(STATE_MESSAGE[preview.state]);
  if (preview.email.toLowerCase() !== sessionUser.email.toLowerCase()) {
    throw new ForbiddenError(`Este convite é para ${preview.email}. Entre com essa conta para aceitá-lo.`);
  }

  return withOrg(preview.orgId, async (tx) => {
    // Revalida dentro da transação para evitar uso duplo do mesmo convite.
    const [inv] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(invitations.id, preview.id),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!inv) throw new ValidationError("Este convite não está mais disponível.");
    const [role] = await tx.select().from(roles).where(eq(roles.id, inv.roleId));
    if (!role) throw new ValidationError("O papel do convite não existe mais.");

    const [current] = await tx.select().from(memberships).where(eq(memberships.userId, sessionUser.id));
    // Quem já é membro ativo não troca de papel por um convite (evita, por exemplo,
    // rebaixar o último proprietário); mudanças de papel passam pela tela de equipe.
    if (current?.status === "active") throw new ConflictError("Você já faz parte desta organização.");
    let membershipId: string;
    if (current) {
      await tx.update(memberships).set({ status: "active", roleId: role.id }).where(eq(memberships.id, current.id));
      membershipId = current.id;
    } else {
      const [m] = await tx
        .insert(memberships)
        .values({ organizationId: preview.orgId, userId: sessionUser.id, roleId: role.id })
        .returning({ id: memberships.id });
      membershipId = m!.id;
    }

    if (role.kind === "client" && inv.clientIds.length) {
      const valid = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(and(inArray(clients.id, inv.clientIds), isNull(clients.deletedAt)));
      await eachInSequence(valid, (c) =>
        tx
          .insert(clientAccess)
          .values({ organizationId: preview.orgId, clientId: c.id, membershipId })
          .onConflictDoNothing(),
      );
    }

    // O link chegou ao e-mail: o endereço está confirmado.
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, sessionUser.id));

    await tx.insert(auditLogs).values({
      organizationId: preview.orgId,
      actorUserId: sessionUser.id,
      action: "joined",
      entityType: "membership",
      entityId: membershipId,
      summary: `${sessionUser.email} entrou como ${role.name}`,
    });
    await tx.insert(domainEvents).values({
      organizationId: preview.orgId,
      type: "member.joined",
      entityType: "membership",
      entityId: membershipId,
      actorUserId: sessionUser.id,
      payload: {
        membershipId,
        userId: sessionUser.id,
        roleKey: role.key,
        roleName: role.name,
        roleKind: role.kind,
        invitationId: inv.id,
        invitedByUserId: inv.invitedByUserId,
        clientIds: role.kind === "client" ? inv.clientIds : [],
      },
    });

    return { slug: preview.orgSlug, kind: role.kind, membershipId };
  });
}

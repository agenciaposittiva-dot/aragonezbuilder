import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { INVITE_ONLY_MESSAGE } from "@/lib/invite-only";
import { agencyCreationAccess } from "@/server/access-key";
import { auth } from "@/server/auth";
import { signUpWithInvitation } from "@/server/auth/invited-signup";
import { runAuthorizedSignup } from "@/server/auth/signup-gate";
import { listUserOrganizations, resolveActor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { account, emailOutbox, invitations, roles, user } from "@/server/db/schema";
import { env } from "@/server/env";
import { ConflictError, LimitError, NotFoundError, ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { createInvitation, invitationCounts, listInvitations, revokeInvitation } from "@/server/services/invitations";
import { as, createOrgWithOwner, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

const tokenOf = (url: string) => url.split("/invite/")[1]!;
let ipSeq = 0;
/** Cada caso usa um IP próprio (o limite por IP é testado à parte). */
const reqHeaders = () => new Headers({ "x-forwarded-for": `10.1.0.${++ipSeq}` });

async function usersWith(email: string) {
  const rows = await withSystem((tx) =>
    tx
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(sql`lower(${user.email}) = ${email.toLowerCase()}`),
  );
  return rows;
}

async function roleId(orgId: string, key: string) {
  const rows = await withSystem((tx) => tx.select().from(roles).where(eq(roles.organizationId, orgId)));
  return rows.find((r) => r.key === key)!.id;
}

async function invite(ctx: Ctx, email: string, key = "designer", clientIds: string[] = []) {
  return as(ctx.actor, async (s) => createInvitation(s, { email, roleId: await roleId(ctx.org.id, key), clientIds }));
}

describe("acesso somente por convite", () => {
  let a: Ctx;
  let b: Ctx;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Privada A", "Dona A");
    b = await createOrgWithOwner("Agência Privada B", "Dono B");
  });

  it("cadastro público é recusado na API (chamada interna e rota HTTP), sem criar conta", async () => {
    const email = "livre@teste.dev";
    await expect(
      auth.api.signUpEmail({ body: { email, name: "Livre", password: "senha-livre-123" } }),
    ).rejects.toMatchObject({ body: { message: INVITE_ONLY_MESSAGE } });

    const base = env.APP_URL.replace(/\/$/, "");
    const res = await auth.handler(
      new Request(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email, name: "Livre", password: "senha-livre-123" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe(INVITE_ONLY_MESSAGE);
    expect(await usersWith(email)).toHaveLength(0);

    // Mesmo com um convite pendente para o e-mail, a rota pública continua fechada.
    await invite(a, "pendente@teste.dev");
    const again = await auth.handler(
      new Request(`${base}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({ email: "pendente@teste.dev", name: "X", password: "senha-livre-123" }),
      }),
    );
    expect(again.status).toBe(403);
    expect(await usersWith("pendente@teste.dev")).toHaveLength(0);
  });

  it("a autorização interna vale só para o e-mail do convite", async () => {
    await expect(
      runAuthorizedSignup("certo@teste.dev", () =>
        auth.api.signUpEmail({ body: { email: "outro@teste.dev", name: "Outro", password: "senha-outro-123" } }),
      ),
    ).rejects.toMatchObject({ body: { message: INVITE_ONLY_MESSAGE } });
    expect(await usersWith("outro@teste.dev")).toHaveLength(0);
  });

  it("convite válido cria a conta do e-mail convidado, com o papel e a agência definidos", async () => {
    const { url } = await invite(a, "nova.designer@teste.dev", "designer");
    const res = await signUpWithInvitation(
      tokenOf(url),
      // Campos extras vindos do navegador são ignorados (não dá para pedir outro papel).
      { name: "Nova Designer", password: "senha-nova-123", role: "owner" } as never,
      reqHeaders(),
    );
    expect(res).toEqual({ slug: a.org.slug, kind: "internal" });
    const [created] = await usersWith("nova.designer@teste.dev");
    expect(created?.emailVerified).toBe(true);

    const actor = (await resolveActor(created!.id, a.org.slug))!;
    expect(actor.roleKey).toBe("designer");
    expect(actor.permissions.has("members.manage")).toBe(false);
    // Nada em outra agência.
    expect(await resolveActor(created!.id, b.org.slug)).toBeNull();
    expect((await listUserOrganizations(created!.id)).map((o) => o.slug)).toEqual([a.org.slug]);

    // Entra com a senha criada.
    const signedIn = await auth.api.signInEmail({
      body: { email: "nova.designer@teste.dev", password: "senha-nova-123" },
    });
    expect(signedIn.user.id).toBe(created!.id);

    // Convidado sem administração não cria agências por conta própria; quem administra, sim.
    expect(await agencyCreationAccess(created!.id, "nova.designer@teste.dev")).toBe(env.ACCESS_KEY ? "key" : "denied");
    expect(await agencyCreationAccess(a.owner.id, a.owner.email)).toBe(env.ACCESS_KEY ? "key" : "open");

    const accepted = await as(a.actor, (s) => listInvitations(s, "accepted"));
    const row = accepted.find((i) => i.email === "nova.designer@teste.dev");
    expect(row?.orgName).toBe("Agência Privada A");
    expect(row?.roleName).toBeTruthy();
  });

  it("convite já usado, expirado, revogado ou inválido não cria conta", async () => {
    const used = await invite(a, "usado@teste.dev");
    await signUpWithInvitation(tokenOf(used.url), { name: "Usado", password: "senha-usado-123" }, reqHeaders());
    await expect(
      signUpWithInvitation(tokenOf(used.url), { name: "Usado 2", password: "senha-usado-123" }, reqHeaders()),
    ).rejects.toThrow(/já foi utilizado/);

    const expired = await invite(a, "expirado@teste.dev");
    await withSystem((tx) =>
      tx
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitations.id, expired.id)),
    );
    await expect(
      signUpWithInvitation(tokenOf(expired.url), { name: "Exp", password: "senha-exp-1234" }, reqHeaders()),
    ).rejects.toBeInstanceOf(ValidationError);

    const revoked = await invite(a, "revogado@teste.dev");
    await as(a.actor, (s) => revokeInvitation(s, revoked.id));
    await expect(
      signUpWithInvitation(tokenOf(revoked.url), { name: "Rev", password: "senha-rev-1234" }, reqHeaders()),
    ).rejects.toThrow(/cancelado/);

    await expect(
      signUpWithInvitation(
        randomBytes(32).toString("base64url"),
        { name: "Xavier", password: "senha-x-12345" },
        reqHeaders(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await usersWith("expirado@teste.dev")).toHaveLength(0);
    expect(await usersWith("revogado@teste.dev")).toHaveLength(0);
    const counts = await as(a.actor, (s) => invitationCounts(s));
    expect(counts.expired).toBeGreaterThanOrEqual(1);
    expect(counts.revoked).toBeGreaterThanOrEqual(1);
    expect(counts.accepted).toBeGreaterThanOrEqual(2);
  });

  it("e-mail que já tem conta não é confirmado nem sobrescrito pelo convite", async () => {
    const { url } = await invite(b, "nova.designer@teste.dev");
    await expect(
      signUpWithInvitation(tokenOf(url), { name: "Intrusa", password: "outra-senha-123" }, reqHeaders()),
    ).rejects.toBeInstanceOf(ConflictError);
    // A senha antiga continua valendo; a conta segue sem acesso à agência B até aceitar entrando.
    const signedIn = await auth.api.signInEmail({
      body: { email: "nova.designer@teste.dev", password: "senha-nova-123" },
    });
    expect(await resolveActor(signedIn.user.id, b.org.slug)).toBeNull();
  });

  it("convite de cliente libera só os clientes escolhidos", async () => {
    const mine = (await as(a.actor, (s) => createClient(s, { name: "Cliente do Convite" }))).id;
    await as(a.actor, (s) => createClient(s, { name: "Outro Cliente" }));
    const { url } = await invite(a, "cliente@teste.dev", "client", [mine]);
    const res = await signUpWithInvitation(tokenOf(url), { name: "Cliente", password: "senha-cli-1234" }, reqHeaders());
    expect(res.kind).toBe("client");
    const [u] = await usersWith("cliente@teste.dev");
    const actor = (await resolveActor(u!.id, a.org.slug))!;
    expect(actor.kind).toBe("client");
    expect(actor.clientIds).toEqual([mine]);
  });

  it("limita tentativas por convite", async () => {
    const bogus = randomBytes(32).toString("base64url");
    const h = reqHeaders();
    for (let i = 0; i < 6; i++) {
      await expect(
        signUpWithInvitation(bogus, { name: "Xavier", password: "senha-x-12345" }, h),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(signUpWithInvitation(bogus, { name: "Xavier", password: "senha-x-12345" }, h)).rejects.toBeInstanceOf(
      LimitError,
    );
  });

  it("contas existentes continuam entrando e a recuperação de senha funciona", async () => {
    // Conta criada antes da mudança (como a semente/implantação faz: direto no banco).
    const ctx = await auth.$context;
    const id = randomUUID();
    await withSystem(async (tx) => {
      await tx.insert(user).values({ id, name: "Antiga", email: "antiga@teste.dev", emailVerified: true });
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await ctx.password.hash("senha-antiga-123"),
      });
    });
    expect(
      (await auth.api.signInEmail({ body: { email: "antiga@teste.dev", password: "senha-antiga-123" } })).user.id,
    ).toBe(id);

    await auth.api.requestPasswordReset({ body: { email: "antiga@teste.dev", redirectTo: "/reset-password" } });
    const [mail] = await withSystem((tx) =>
      tx.select().from(emailOutbox).where(eq(emailOutbox.to, "antiga@teste.dev")),
    );
    const resetToken = mail?.text.match(/reset-password\/([A-Za-z0-9_-]+)/)?.[1];
    expect(resetToken).toBeTruthy();
    await auth.api.resetPassword({ body: { token: resetToken!, newPassword: "senha-nova-antiga-123" } });
    expect(
      (await auth.api.signInEmail({ body: { email: "antiga@teste.dev", password: "senha-nova-antiga-123" } })).user.id,
    ).toBe(id);
    // E a recuperação não cria contas para e-mails desconhecidos.
    await auth.api.requestPasswordReset({ body: { email: "ninguem@teste.dev", redirectTo: "/reset-password" } });
    expect(await usersWith("ninguem@teste.dev")).toHaveLength(0);
  });
});

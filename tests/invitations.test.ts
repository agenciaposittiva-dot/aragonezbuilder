import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveActor } from "@/server/authz/actor";
import { withOrg, withSystem } from "@/server/db";
import { emailOutbox, invitations, memberships, roles, user } from "@/server/db/schema";
import { createClient, getClient } from "@/server/services/clients";
import {
  acceptInvitation,
  createInvitation,
  getInvitationByToken,
  hashToken,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/server/services/invitations";
import { listMembers, setMemberStatus, updateMember } from "@/server/services/team";
import { addMember, as, createOrgWithOwner, createUser, resetDb } from "./helpers";

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;

async function roleId(orgId: string, key: string) {
  const rows = await withOrg(orgId, (tx) => tx.select().from(roles).where(eq(roles.key, key)));
  return rows[0]!.id;
}

const tokenOf = (url: string) => url.split("/invite/")[1]!;

describe("convites", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Convites", "Dona");
  });

  it("convite guarda só o hash do token e envia e-mail", async () => {
    const { url, id } = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "Designer@Teste.dev", roleId: await roleId(ctx.org.id, "designer") }),
    );
    const token = tokenOf(url);
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(invitations).where(eq(invitations.id, id)));
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect(row?.email).toBe("designer@teste.dev");
    const mails = await withSystem((tx) =>
      tx.select().from(emailOutbox).where(eq(emailOutbox.to, "designer@teste.dev")),
    );
    expect(mails.length).toBe(1);
    expect(mails[0]?.text).toContain(url);
  });

  it("aceite cria o vínculo com o papel do convite", async () => {
    const u = await createUser("Davi", "davi@teste.dev");
    const { url } = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "davi@teste.dev", roleId: await roleId(ctx.org.id, "copywriter") }),
    );
    const res = await acceptInvitation(tokenOf(url), { id: u.id, email: "DAVI@teste.dev" });
    expect(res.kind).toBe("internal");
    const actor = await resolveActor(u.id, ctx.org.slug);
    expect(actor?.roleKey).toBe("copywriter");
    const [row] = await withSystem((tx) => tx.select().from(user).where(eq(user.id, u.id)));
    expect(row?.emailVerified).toBe(true);
    // o mesmo link não pode ser usado de novo
    await expect(acceptInvitation(tokenOf(url), { id: u.id, email: "davi@teste.dev" })).rejects.toThrow(
      /já foi utilizado/i,
    );
  });

  it("quem já é membro ativo não troca de papel ao aceitar um convite antigo", async () => {
    const u = await createUser("Iara", "iara@teste.dev");
    const { url } = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "iara@teste.dev", roleId: await roleId(ctx.org.id, "collaborator") }),
    );
    // A pessoa passa a ser membro ativo por outro caminho antes de aceitar.
    const managerRole = await roleId(ctx.org.id, "manager");
    await withSystem((tx) =>
      tx.insert(memberships).values({ organizationId: ctx.org.id, userId: u.id, roleId: managerRole }),
    );
    await expect(acceptInvitation(tokenOf(url), { id: u.id, email: "iara@teste.dev" })).rejects.toThrow(
      /já faz parte/i,
    );
    const actor = await resolveActor(u.id, ctx.org.slug);
    expect(actor?.roleKey).toBe("manager");
  });

  it("recusa aceite com outro e-mail", async () => {
    const intruder = await createUser("Intrusa", "intrusa@teste.dev");
    const { url } = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "convidado@teste.dev", roleId: await roleId(ctx.org.id, "designer") }),
    );
    await expect(acceptInvitation(tokenOf(url), { id: intruder.id, email: intruder.email })).rejects.toThrow(
      /convidado@teste.dev/,
    );
    expect(await resolveActor(intruder.id, ctx.org.slug)).toBeNull();
  });

  it("recusa convites expirados e revogados; reenvio invalida o link antigo", async () => {
    const u = await createUser("Eva", "eva@teste.dev");
    const expired = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "eva@teste.dev", roleId: await roleId(ctx.org.id, "designer") }),
    );
    await withOrg(ctx.org.id, (tx) =>
      tx
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(invitations.id, expired.id)),
    );
    expect((await getInvitationByToken(tokenOf(expired.url)))?.state).toBe("expired");
    await expect(acceptInvitation(tokenOf(expired.url), { id: u.id, email: u.email })).rejects.toThrow(/expirou/i);

    const renewed = await as(ctx.actor, (s) => resendInvitation(s, expired.id));
    expect(await getInvitationByToken(tokenOf(expired.url))).toBeNull();
    expect((await getInvitationByToken(tokenOf(renewed.url)))?.state).toBe("valid");

    await as(ctx.actor, (s) => revokeInvitation(s, expired.id));
    await expect(acceptInvitation(tokenOf(renewed.url), { id: u.id, email: u.email })).rejects.toThrow(/cancelado/i);
    const pending = await as(ctx.actor, (s) => listInvitations(s));
    expect(pending.find((p) => p.id === expired.id)).toBeUndefined();
  });

  it("convite de cliente concede acesso apenas aos clientes escolhidos", async () => {
    const mine = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Convidado" }))).id;
    const other = (await as(ctx.actor, (s) => createClient(s, { name: "Outro" }))).id;
    await expect(
      as(ctx.actor, async (s) =>
        createInvitation(s, { email: "cli@teste.dev", roleId: await roleId(ctx.org.id, "client") }),
      ),
    ).rejects.toThrow(/cliente/i);
    const { url } = await as(ctx.actor, async (s) =>
      createInvitation(s, { email: "cli@teste.dev", roleId: await roleId(ctx.org.id, "client"), clientIds: [mine] }),
    );
    const u = await createUser("Cli", "cli@teste.dev");
    const res = await acceptInvitation(tokenOf(url), { id: u.id, email: u.email });
    expect(res.kind).toBe("client");
    const actor = (await resolveActor(u.id, ctx.org.slug))!;
    expect(actor.clientIds).toEqual([mine]);
    await expect(as(actor, (s) => getClient(s, other))).rejects.toThrow(/não encontrado/i);
  });

  it("só quem gerencia a equipe convida; só proprietário convida proprietário", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer");
    await expect(
      as(designer, async (s) =>
        createInvitation(s, { email: "x@teste.dev", roleId: await roleId(ctx.org.id, "designer") }),
      ),
    ).rejects.toThrow(/permissão/i);
    const manager = await addMember(ctx.org.slug, ctx.org.id, "manager");
    await expect(
      as(manager, async (s) =>
        createInvitation(s, { email: "y@teste.dev", roleId: await roleId(ctx.org.id, "owner") }),
      ),
    ).rejects.toThrow(/proprietário/i);
  });
});

describe("gestão da equipe", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    await resetDb();
    ctx = await createOrgWithOwner("Agência Equipe", "Dono Único");
  });

  it("não permite deixar a organização sem proprietário ativo", async () => {
    const admin = await addMember(ctx.org.slug, ctx.org.id, "admin");
    // admin não pode mexer no proprietário
    await expect(
      as(admin, (s) => setMemberStatus(s, { membershipId: ctx.actor.membershipId, status: "suspended" })),
    ).rejects.toThrow(/proprietário/i);
    // o próprio dono não pode se rebaixar sendo o único
    await expect(
      as(ctx.actor, async (s) =>
        updateMember(s, { membershipId: ctx.actor.membershipId, roleId: await roleId(ctx.org.id, "admin") }),
      ),
    ).rejects.toThrow(/proprietário ativo/i);
    // com um segundo dono, o rebaixamento passa
    const second = await addMember(ctx.org.slug, ctx.org.id, "owner", { name: "Sócia" });
    await as(second, async (s) =>
      updateMember(s, { membershipId: ctx.actor.membershipId, roleId: await roleId(ctx.org.id, "admin") }),
    );
    // agora a sócia é a única dona: não pode ser removida pelo admin rebaixado nem por si mesma
    const demoted = (await resolveActor(ctx.owner.id, ctx.org.slug))!;
    await expect(
      as(demoted, (s) => setMemberStatus(s, { membershipId: second.membershipId, status: "removed" })),
    ).rejects.toThrow(/proprietário/i);
  });

  it("remoção revoga o acesso imediatamente", async () => {
    const designer = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Saindo" });
    const owner = (await as(ctx.actor, (s) => listMembers(s))).find((m) => m.roleKey === "owner")!;
    const ownerActor = (await resolveActor(owner.userId, ctx.org.slug))!;
    await as(ownerActor, (s) => setMemberStatus(s, { membershipId: designer.membershipId, status: "removed" }));
    expect(await resolveActor(designer.userId, ctx.org.slug)).toBeNull();
  });

  it("custo/hora fica oculto para quem não vê custos", async () => {
    const owner = (await as(ctx.actor, (s) => listMembers(s))).find((m) => m.roleKey === "owner")!;
    const ownerActor = (await resolveActor(owner.userId, ctx.org.slug))!;
    const target = await addMember(ctx.org.slug, ctx.org.id, "designer", { name: "Com custo" });
    await as(ownerActor, (s) => updateMember(s, { membershipId: target.membershipId, hourlyCost: "80,00" }));
    const asOwner = (await as(ownerActor, (s) => listMembers(s))).find((m) => m.membershipId === target.membershipId);
    expect(asOwner?.hourlyCostCents).toBe(8000);
    const account = await addMember(ctx.org.slug, ctx.org.id, "account");
    const asAccount = (await as(account, (s) => listMembers(s))).find((m) => m.membershipId === target.membershipId);
    expect(asAccount?.hourlyCostCents).toBeNull();
    await expect(
      as(account, (s) => updateMember(s, { membershipId: target.membershipId, hourlyCost: "1,00" })),
    ).rejects.toThrow();
  });
});

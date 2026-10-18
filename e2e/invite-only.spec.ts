import { expect, test } from "@playwright/test";
import { createInviteLink, DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Plataforma privada: sem cadastro público (tela, endereço antigo e API),
 * conta criada só pelo link do convite, com o papel definido por quem
 * convidou; convites usados, revogados ou de outro e-mail não servem; a área
 * de convites mostra a situação, a agência e o papel. Recuperação de senha e
 * contas existentes continuam funcionando.
 */

const ORG = `/w/${DEMO.org}`;
const MESSAGE = /Esta plataforma é privada e o acesso está disponível somente por convite/;

test.describe("acesso somente por convite", () => {
  test("login sem cadastro público; /signup e a API recusam criar conta", async ({ page, request }, info) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await expect(page.getByText(/Criar conta/)).toHaveCount(0);
    await expect(page.locator('a[href="/signup"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Esqueci a senha" })).toBeVisible();
    await expect(page.getByText("Manter conectado")).toBeVisible();
    await expect(page.getByTestId("login-invite-note")).toContainText("convite");
    await expectNoHorizontalScroll(page);

    await page.goto("/signup");
    await expect(page.getByTestId("invite-only")).toContainText(MESSAGE);
    await expect(page.locator("input")).toHaveCount(0);

    const email = `sem-convite-${info.project.name}-${Date.now().toString(36)}@teste.dev`;
    const res = await request.post("/api/auth/sign-up/email", {
      headers: { origin: new URL(page.url()).origin },
      data: { email, name: "Sem Convite", password: "senha-sem-convite-1" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).message).toMatch(MESSAGE);
    // Nenhuma conta foi criada: entrar com esses dados falha.
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", "senha-sem-convite-1");
    await page.click("button[type=submit]");
    await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos." })).toBeVisible();
  });

  test("convite cria a conta com o papel definido; link usado, revogado ou de outro e-mail não serve", async ({
    page,
    browser,
  }, info) => {
    const tag = `${info.project.name}-${Date.now().toString(36)}`;
    const email = `designer-${tag}@teste.dev`;

    // Convite pela tela de Equipe (sem SMTP, a tela mostra o link e avisa que o e-mail não foi enviado).
    const path = await createInviteLink(browser, email, "Designer");
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: /Convite para a equipe de/ })).toBeVisible();
    await expect(page.getByText("Designer", { exact: true })).toBeVisible();
    await expect(page.locator("#inv-email")).toHaveValue(email);
    await expect(page.locator("#inv-email")).toHaveAttribute("readonly", "");
    await page.fill("#inv-name", `Designer ${tag}`);
    await page.fill("#inv-password", "senha-designer-1");
    await page.getByRole("button", { name: "Criar conta e aceitar" }).click();
    await page.waitForURL(new RegExp(`${ORG}`), { timeout: 60_000 });

    // Só o papel concedido: sem gerenciar equipe e sem criar agências.
    await page.goto(`${ORG}/team?tab=invites`);
    await expect(page.getByRole("button", { name: "Convidar usuário" })).toHaveCount(0);
    await page.goto("/onboarding");
    await expect(page.getByTestId("no-agency-access")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar agência" })).toHaveCount(0);

    // Logado com esta conta, um convite para outro e-mail não pode ser aceito.
    const otherPath = await createInviteLink(browser, `outra-${tag}@teste.dev`, "Designer");
    await page.goto(otherPath);
    await expect(page.getByText(/mas o convite é para outra-/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Aceitar convite" })).toHaveCount(0);

    // Sem sessão: o link já usado não cria outra conta.
    await page.context().clearCookies();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Convite já utilizado" })).toBeVisible();
    await expect(page.locator("#inv-password")).toHaveCount(0);

    // A conta criada entra normalmente.
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", "senha-designer-1");
    await page.click("button[type=submit]");
    await page.waitForURL(new RegExp(ORG), { timeout: 60_000 });

    // Revogar: a proprietária cancela o convite pendente e o link deixa de funcionar.
    const owner = await browser.newContext({ baseURL: info.project.use.baseURL });
    const admin = await owner.newPage();
    await login(admin, DEMO.owner);
    await admin.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
    await admin.goto(`${ORG}/team?tab=invites&status=pending`);
    const pendingRow = admin.getByTestId("invitation-row").filter({ hasText: `outra-${tag}@teste.dev` });
    await expect(pendingRow).toContainText("Designer");
    await pendingRow.getByRole("button", { name: "Cancelar" }).click();
    await expect(pendingRow).toHaveCount(0);
    await admin.goto(`${ORG}/team?tab=invites&status=revoked`);
    await expect(admin.getByTestId("invitation-row").filter({ hasText: `outra-${tag}@teste.dev` })).toBeVisible();
    await admin.goto(`${ORG}/team?tab=invites&status=accepted`);
    const acceptedRow = admin.getByTestId("invitation-row").filter({ hasText: email });
    await expect(acceptedRow).toContainText("Designer");
    await expect(acceptedRow).toContainText("Estúdio Aurora");
    await owner.close();

    await page.context().clearCookies();
    await page.goto(otherPath);
    await expect(page.getByRole("heading", { name: "Convite cancelado" })).toBeVisible();
    await expect(page.locator("#inv-password")).toHaveCount(0);
  });

  test("recuperação de senha e contas existentes continuam funcionando", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.fill("#email", DEMO.owner);
    await page.getByRole("button", { name: /Enviar|Recuperar|link/i }).click();
    await expect(page.getByRole("heading", { name: "Verifique o seu e-mail" })).toBeVisible();

    await login(page, DEMO.owner);
    await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
    await page.goto(ORG);
    await expect(page.getByRole("button", { name: "Menu do perfil" })).toBeVisible();
  });
});

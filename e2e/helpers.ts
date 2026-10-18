import { expect, test, type Browser, type Page } from "@playwright/test";

/** Contas da agência de demonstração (npm run db:seed). */
export const DEMO = {
  org: "estudio-aurora",
  password: process.env.SEED_PASSWORD || "aurora-demo-2026",
  owner: "helena@demo.aragonez.app",
  guest: "paula@demo.aragonez.app",
  guestClient: "cafe-serra-azul",
  otherClient: "clinica-vitta",
};

export async function login(page: Page, email: string, path = "/login") {
  await page.goto(path);
  await page.fill("#email", email);
  await page.fill("#password", DEMO.password);
  await page.click("button[type=submit]");
}

/** A página não pode rolar na horizontal (layout quebrado em telas pequenas). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Sessão da proprietária da agência de demonstração em um navegador separado. */
async function ownerPage(browser: Browser) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
  return page;
}

/** A proprietária cria o convite pela tela de Equipe e devolve o link (sem SMTP, a tela mostra o link). */
export async function createInviteLink(browser: Browser, email: string, role = "Administrador") {
  const admin = await ownerPage(browser);
  await admin.goto(`/w/${DEMO.org}/team?tab=invites`);
  await admin.waitForLoadState("networkidle");
  await expectNoHorizontalScroll(admin);
  await admin.getByRole("button", { name: "Convidar usuário" }).click();
  const dialog = admin.getByRole("dialog");
  await dialog.locator("#inv-email").fill(email);
  await dialog.locator("#inv-role").selectOption({ label: role });
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog.getByRole("heading", { name: "Convite criado" })).toBeVisible();
  const url = (await dialog.locator("code").first().innerText()).trim();
  await admin.context().close();
  return new URL(url).pathname;
}

/**
 * Conta nova pela única porta de entrada da plataforma privada: convite da
 * proprietária e cadastro pelo link. A página termina logada na agência.
 */
export async function inviteAndSignUp(
  page: Page,
  browser: Browser,
  opts: { email: string; name: string; password: string; role?: string },
) {
  const path = await createInviteLink(browser, opts.email, opts.role);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.fill("#inv-name", opts.name);
  await page.fill("#inv-password", opts.password);
  await page.getByRole("button", { name: "Criar conta e aceitar" }).click();
  await page.waitForURL(new RegExp(`/w/${DEMO.org}`), { timeout: 60_000 });
  return path;
}

/** A proprietária remove a pessoa da agência de demonstração (ela continua com as agências próprias). */
export async function removeFromDemo(browser: Browser, name: string) {
  const admin = await ownerPage(browser);
  await admin.goto(`/w/${DEMO.org}/team`);
  await admin.waitForLoadState("networkidle");
  await admin.getByRole("button", { name: `Ações para ${name}` }).click();
  await admin.getByRole("menuitem", { name: "Remover da organização" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Remover" }).click();
  await expect(admin.getByRole("button", { name: `Ações para ${name}` })).toHaveCount(0);
  await admin.context().close();
}

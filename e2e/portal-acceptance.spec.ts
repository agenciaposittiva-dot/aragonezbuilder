import { expect, test, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Testes de aceitação do portal do cliente (os 18 itens do pedido), de ponta a
 * ponta no navegador: a agência personaliza e publica dois portais, convida
 * um usuário externo, ele aceita, cria uma demanda e decide aprovações; a
 * agência revoga o acesso. Fluxo longo, executado só no computador — o
 * celular é coberto em portal.spec.ts.
 */

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "fluxo longo só no computador");
});

const ORG = `/w/${DEMO.org}`;
const tag = Date.now().toString(36);
const A = `Aceite Alfa ${tag}`;
const B = `Aceite Beta ${tag}`;
const C = `Aceite Gama ${tag}`;
const guestEmail = `convidado-${tag}@teste.dev`;
const guestName = `Convidado ${tag}`;
const guestPassword = "convidado-2026-ok";
const state: { idA?: string; idB?: string; idC?: string; slugA?: string; slugB?: string; slugC?: string } = {};

const png = (color: string) =>
  sharp({ create: { width: 240, height: 240, channels: 3, background: color } })
    .png()
    .toBuffer();

async function enter(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

async function createClient(page: Page, name: string) {
  await page.goto(`${ORG}/clients`);
  await page.getByRole("button", { name: "Novo cliente" }).first().click();
  await page.fill("#c-name", name);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  return page.url().split("/clients/")[1]!.split(/[/?#]/)[0]!;
}

/** Personaliza e publica o portal do cliente pela tela da agência. Devolve o endereço. */
async function personalize(page: Page, clientId: string, opts: { name: string; color: string; banner: string }) {
  await page.goto(`${ORG}/clients/${clientId}/portal`);
  // Espera a tela ficar interativa: preencher antes da hidratação perde o valor.
  await page.waitForLoadState("networkidle");
  const slug = await page.inputValue("#pc-slug");
  await page.fill("#pc-name", opts.name);
  await expect(page.locator("#pc-name")).toHaveValue(opts.name);
  const uploaded = page.waitForResponse((r) => r.url().includes("/api/uploads") && r.request().method() === "POST");
  await page.setInputFiles("#pc-logo", { name: "logo.png", mimeType: "image/png", buffer: await png(opts.color) });
  expect((await uploaded).ok()).toBe(true);
  await page.fill("#pc-primary", opts.color);
  await page.fill("#pc-b-title", opts.banner);
  await expect(page.locator("#pc-name")).toHaveValue(opts.name);
  // 3. Prévia antes de publicar (aba Início mostra o banner; Login mostra o nome).
  await expect(page.getByText(opts.name).first()).toBeVisible();
  await page.getByRole("tab", { name: "Início" }).first().click();
  await expect(page.getByText(opts.banner).nth(0)).toBeAttached();
  await page.getByRole("button", { name: "Publicar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publicar" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: /publicad/i })).toBeVisible();
  return slug;
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  return ctx.newPage();
}

/** Convidado entra pelo login do portal do cliente A. */
async function guestLogin(browser: Browser) {
  const guest = await newPage(browser);
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/entrar`);
  await guest.fill("#email", guestEmail);
  await guest.fill("#password", guestPassword);
  await guest.click("button[type=submit]");
  await guest.waitForURL(new RegExp(`/portal/${DEMO.org}/${state.slugA}$`), { timeout: 60_000 });
  return guest;
}

async function uploadClientFile(page: Page, clientId: string, name: string, color: string) {
  await page.goto(`${ORG}/clients/${clientId}/files`);
  await page.getByRole("button", { name: "Enviar arquivos" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer: await png(color) });
  const uploaded = page.waitForResponse((r) => r.url().includes("/api/uploads") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Enviar/ }).click();
  expect((await uploaded).ok()).toBe(true);
  // A janela pode fechar sozinha ao concluir; se continuar aberta, fecha.
  await page.waitForTimeout(500);
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("link", { name: new RegExp(name.replace(".png", "")) })
    .first()
    .click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}/);
  return page.url().split("/files/")[1]!.split(/[/?#]/)[0]!;
}

async function sendToClient(page: Page) {
  await page.getByRole("button", { name: "Enviar ao cliente" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Enviado para aprovação do cliente" }),
  ).toBeVisible();
}

test("1–4 e 18: dois portais com identidades diferentes e um sem personalização", async ({ page, browser }) => {
  await enter(page, DEMO.owner);
  state.idA = await createClient(page, A);
  state.idB = await createClient(page, B);
  state.idC = await createClient(page, C);
  state.slugA = await personalize(page, state.idA, {
    name: `Portal ${A}`,
    color: "#1f6f43",
    banner: `Bem-vindos, ${A}`,
  });
  state.slugB = await personalize(page, state.idB, { name: `Portal ${B}`, color: "#6b2fa3", banner: `Olá, ${B}` });
  await page.goto(`${ORG}/clients/${state.idC}/portal`);
  state.slugC = await page.inputValue("#pc-slug");

  // 4. Cada login mostra a própria identidade, sem misturar.
  const anon = await newPage(browser);
  await anon.goto(`/portal/${DEMO.org}/${state.slugA}/entrar`);
  await expect(anon.getByText(`Portal ${A}`).first()).toBeAttached();
  await expect(anon.getByText(`Portal ${B}`)).toHaveCount(0);
  await anon.goto(`/portal/${DEMO.org}/${state.slugB}/entrar`);
  await expect(anon.getByText(`Portal ${B}`).first()).toBeAttached();
  await expect(anon.getByText(`Portal ${A}`)).toHaveCount(0);
  // 18. Sem personalização: login funciona com o padrão da agência e o nome do cliente.
  await anon.goto(`/portal/${DEMO.org}/${state.slugC}/entrar`);
  await expect(anon.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
  await expect(anon.getByText(new RegExp(`espaço de ${C}`))).toBeVisible();
  await anon.context().close();
});

let inviteUrl = "";

test("5–7 e 17: convite, aceite e acesso só ao cliente certo", async ({ page, browser }) => {
  await enter(page, DEMO.owner);
  await page.goto(`${ORG}/clients/${state.idA}/guests`);
  await page.getByRole("button", { name: "Convidar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#inv-email").fill(guestEmail);
  await dialog.locator("#inv-name").fill(guestName);
  await dialog.locator("#inv-role").selectOption({ label: "Cliente (acesso completo)" });
  await dialog.getByRole("button", { name: "Criar convite" }).click();
  await expect(dialog.getByRole("heading", { name: "Convite criado" })).toBeVisible();
  // Sem SMTP o e-mail não é enviado — a tela diz isso e mostra o link.
  inviteUrl = (await dialog.locator("code").first().innerText()).trim();
  expect(inviteUrl).toMatch(/\/invite\//);

  const guest = await newPage(browser);
  await guest.goto(new URL(inviteUrl).pathname);
  await guest.fill("#inv-name", guestName);
  await guest.fill("#inv-password", guestPassword);
  await guest.locator("button[type=submit]").click();
  await guest.waitForURL(new RegExp(`/portal/${DEMO.org}/${state.slugA}`), { timeout: 60_000 });
  await expect(guest.getByText(`Bem-vindos, ${A}`).first()).toBeVisible();

  // 7/17. Outro cliente, inclusive pelo endereço direto: negado sem revelar dados.
  await guest.goto(`/portal/${DEMO.org}/${state.slugB}`);
  await expect(guest).toHaveURL(/negado=1/);
  await expect(guest.getByText(`Olá, ${B}`)).toHaveCount(0);
  await guest.goto(`/portal/${DEMO.org}/${DEMO.guestClient}/files`);
  await expect(guest).toHaveURL(/negado=1/);
  // O link de convite não vale duas vezes.
  await guest.context().clearCookies();
  await guest.goto(new URL(inviteUrl).pathname);
  await expect(guest.getByText(/já foi usado|aceito/i).first()).toBeVisible();
  await guest.context().close();
});

const demandTitle = `Demanda de aceite ${tag}`;

test("9: demanda criada no portal aparece para a agência", async ({ page, browser }) => {
  const guest = await guestLogin(browser);
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/requests/new`);
  await guest.fill("#rq-title", demandTitle);
  await guest.getByRole("button", { name: "Enviar solicitação" }).click();
  await expect(guest.getByText(demandTitle).first()).toBeVisible({ timeout: 30_000 });
  await guest.context().close();

  await enter(page, DEMO.owner);
  await page.goto(`${ORG}/requests`);
  await expect(page.getByText(demandTitle).first()).toBeVisible();
});

let privateFileId = "";

test("10–14: aprovação, ajustes com motivo, histórico e arquivo privado protegido", async ({ page, browser }) => {
  await enter(page, DEMO.owner);
  const first = await uploadClientFile(page, state.idA!, `peca-aprovar-${tag}.png`, "#2a9d8f");
  await sendToClient(page);
  const second = await uploadClientFile(page, state.idA!, `peca-ajustar-${tag}.png`, "#e76f51");
  await sendToClient(page);
  privateFileId = await uploadClientFile(page, state.idA!, `peca-interna-${tag}.png`, "#264653");

  const guest = await guestLogin(browser);

  // 11. Aprovar uma versão.
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/files/${first}`);
  await guest.getByRole("button", { name: /^Aprovar/ }).click();
  await expect(guest.locator("[data-sonner-toast]").filter({ hasText: "Decisão registrada" })).toBeVisible();
  // 12. Pedir ajustes em outra, com motivo obrigatório.
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/files/${second}`);
  await guest.getByRole("button", { name: "Solicitar ajustes" }).click();
  const send = guest.getByRole("dialog").getByRole("button", { name: "Enviar pedido de ajustes" });
  await expect(send).toBeDisabled();
  await guest.getByRole("dialog").locator("textarea").fill("Trocar a cor do fundo para o tom da marca.");
  await send.click();
  await expect(guest.locator("[data-sonner-toast]").filter({ hasText: "Decisão registrada" }).last()).toBeVisible();
  // 14. Arquivo não compartilhado: invisível para o convidado, mesmo com o endereço direto.
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/files/${privateFileId}`);
  await expect(guest.getByText(/não encontrad/i).first()).toBeVisible();
  await expect(guest.getByText(`peca-interna-${tag}`)).toHaveCount(0);
  await guest.context().close();

  // 13. Histórico registrado na agência.
  await page.goto(`${ORG}/files/${first}`);
  await expect(page.getByText(/Aprovad/).first()).toBeVisible();
  await expect(page.getByText(guestName).first()).toBeVisible();
  await page.goto(`${ORG}/files/${second}`);
  await expect(page.getByText("Trocar a cor do fundo para o tom da marca.").first()).toBeVisible();
});

test("16: convite inválido e senha errada não revelam nada", async ({ page }) => {
  await page.goto("/invite/token-invalido-que-nao-existe-123456");
  await expect(page.getByText(/inválido|não encontrado|expirou/i).first()).toBeVisible();
  await page.goto(`/portal/${DEMO.org}/${state.slugA}/entrar`);
  await page.fill("#email", guestEmail);
  await page.fill("#password", "senha-errada-123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos" })).toBeVisible();
});

test("8: revogar o acesso nega a entrada depois", async ({ page, browser }) => {
  await enter(page, DEMO.owner);
  await page.goto(`${ORG}/clients/${state.idA}/guests`);
  await page.getByRole("button", { name: `Remover acesso de ${guestName}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remover acesso" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();

  const guest = await newPage(browser);
  await guest.goto(`/portal/${DEMO.org}/${state.slugA}/entrar`);
  await guest.fill("#email", guestEmail);
  await guest.fill("#password", guestPassword);
  await guest.click("button[type=submit]");
  await expect(guest.getByText(/não tem acesso|suspensa|incorretos/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByText(`Bem-vindos, ${A}`)).toHaveCount(0);
  await expectNoHorizontalScroll(guest);
  await guest.context().close();
});

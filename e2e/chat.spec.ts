import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Chat da Equipe com duas pessoas em navegadores separados: troca em tempo
 * real (sem recarregar), histórico após recarregar, não lidas, anexo com
 * download autorizado, busca e tarefa criada a partir de uma mensagem.
 */

const ORG = `/w/${DEMO.org}`;
const RAFAEL = "rafael@demo.aragonez.app";
const SHOTS = process.env.E2E_SHOTS_DIR;

// PNG 1×1 válido (o servidor confere o tipo real pelo conteúdo).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function person(browser: Browser, info: TestInfo, email: string) {
  const u = info.project.use;
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  });
  // O selo do `next dev` cobre controles no celular.
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
    });
  });
  const page = await context.newPage();
  await login(page, email);
  await page.waitForURL((url) => url.pathname === "/" || url.pathname.startsWith("/w/"), { timeout: 60_000 });
  await page.goto(`${ORG}/chat`);
  await page.waitForLoadState("networkidle");
  return page;
}

function composer(page: Page) {
  return page.getByRole("textbox", { name: "Mensagem" });
}

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/chat-${info.project.name}-${name}.png` });
}

test.describe("chat da equipe", () => {
  test("duas pessoas conversam em tempo real, com anexo, busca e tarefa", async ({ browser, request }, info) => {
    const mobile = info.project.name === "mobile";
    const token = Date.now().toString(36);
    const group = `E2E Chat ${token}`;
    const helena = await person(browser, info, DEMO.owner);
    const rafael = await person(browser, info, RAFAEL);
    await expectNoHorizontalScroll(helena);

    // Helena cria um grupo com o Rafael e escreve.
    await helena.getByRole("button", { name: "Nova conversa" }).first().click();
    const dialog = helena.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Grupo" }).click();
    await dialog.locator("#chat-group-name").fill(group);
    await dialog.getByRole("option", { name: /Rafael Nunes/ }).click();
    await dialog.getByRole("button", { name: "Criar grupo" }).click();
    await helena.waitForURL(/\/chat\/[0-9a-f-]{36}/);
    const conversationUrl = new URL(helena.url()).pathname;
    await send(helena, `Bom dia, @Rafael Nunes! Briefing ${token} pronto?`);
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Briefing ${token}` })).toBeVisible();

    // Rafael vê a conversa como não lida (sem recarregar a página dele).
    const row = rafael.getByTestId("chat-conversation").filter({ hasText: group });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByLabel(/não lidas/)).toBeVisible();
    if (!mobile) await expect(rafael.getByRole("link", { name: /Chat da Equipe\s*\d+/ })).toBeVisible();
    await shot(rafael, info, "nao-lidas");
    await row.click();
    await expect(rafael.getByTestId("chat-message").filter({ hasText: `Briefing ${token}` })).toBeVisible();
    await expectNoHorizontalScroll(rafael);

    // Resposta chega para a Helena em tempo real.
    await send(rafael, `Quase! Revisão ${token} até as 15h.`);
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Revisão ${token}` })).toBeVisible({
      timeout: 15_000,
    });

    // Anexo: Rafael envia uma imagem; Helena vê e baixa pelo link autorizado.
    await rafael
      .getByTestId("chat-file-input")
      .setInputFiles({ name: `ref-${token}.png`, mimeType: "image/png", buffer: PNG });
    await expect(rafael.getByLabel("Enviado")).toBeVisible();
    await rafael.getByRole("button", { name: "Enviar" }).click();
    const image = helena.getByRole("img", { name: `ref-${token}.png` });
    await expect(image).toBeVisible({ timeout: 15_000 });
    const src = (await image.getAttribute("src"))!;
    const download = await helena.request.get(src);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("image/png");
    // Sem sessão o anexo não abre.
    const anonymous = await request.get(src, { maxRedirects: 0 });
    expect([401, 403, 404]).toContain(anonymous.status());

    // Histórico continua depois de recarregar.
    await helena.reload();
    await helena.waitForLoadState("networkidle");
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Briefing ${token}` })).toBeVisible();
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Revisão ${token}` })).toBeVisible();
    await shot(helena, info, "conversa");

    // Busca encontra a mensagem e abre no ponto certo.
    if (mobile) await helena.getByRole("button", { name: "Voltar às conversas" }).click();
    await helena.getByRole("textbox", { name: "Buscar conversas e mensagens" }).fill(`Revisão ${token}`);
    const result = helena.getByTestId("chat-search-result").filter({ hasText: `Revisão ${token}` });
    await expect(result).toBeVisible();
    await result.click();
    await expect(helena).toHaveURL(new RegExp(`${conversationUrl}\\?m=\\d+`));
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Revisão ${token}` })).toBeVisible();

    // Tarefa a partir da mensagem (com confirmação no diálogo).
    const message = helena.getByTestId("chat-message").filter({ hasText: `Revisão ${token}` });
    await message.click();
    await message.getByRole("button", { name: "Mais ações da mensagem" }).click();
    await helena.getByRole("menuitem", { name: "Criar tarefa" }).click();
    const taskDialog = helena.getByRole("dialog");
    await expect(taskDialog.locator("#chat-task-title")).toHaveValue(/Revisão/);
    await taskDialog.locator("#chat-task-project").selectOption({ index: 1 });
    await taskDialog.getByRole("button", { name: "Criar tarefa" }).click();
    await expect(helena.getByText("Tarefa criada e vinculada à mensagem")).toBeVisible();
    const taskChip = message.getByRole("button", { name: /Tarefa:/ });
    await expect(taskChip).toBeVisible({ timeout: 15_000 });
    await taskChip.click();
    await expect(helena.getByRole("dialog").getByRole("link", { name: /Abrir tarefa completa/ })).toBeVisible();
    await expectNoHorizontalScroll(helena);
    await shot(helena, info, "tarefa");

    await helena.context().close();
    await rafael.context().close();
  });

  test("clientes não acessam o chat", async ({ page }) => {
    await login(page, DEMO.guest);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    const res = await page.request.get(`/api/chat/sync?org=${DEMO.org}`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
    await page.goto(`${ORG}/chat`);
    await expect(page.getByRole("textbox", { name: "Mensagem" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Chat da Equipe" })).toHaveCount(0);
  });
});

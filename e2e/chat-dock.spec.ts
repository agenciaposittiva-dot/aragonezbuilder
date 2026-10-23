import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * Janela flutuante do Chat da Equipe e avisos de eventos da plataforma:
 * abrir, minimizar, restaurar e fechar; conversa e rascunho continuam ao
 * navegar entre módulos; aviso de mensagem abre a conversa na janela sem sair
 * da página; chat no editor com o canvas à vista; tela de login sem chat nem
 * avisos; aviso de evento (comentário numa demanda) abre a demanda certa.
 */

const ORG = `/w/${DEMO.org}`;
const RAFAEL = "rafael@demo.aragonez.app";
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 640;
const frameOf = (page: Page) => page.frameLocator("[data-testid=chat-dock-frame]");

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
  return page;
}

/** Abre (ou cria) a conversa direta com alguém pela página do chat e devolve o id. */
async function directWith(page: Page, name: RegExp) {
  await page.goto(`${ORG}/chat`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nova conversa" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Pessoa" }).click();
  await dialog.getByRole("option", { name }).click();
  await dialog.getByRole("button", { name: "Conversar" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Envia pela mesma API do compositor (mensagem real, gravada no banco). */
async function sendAs(page: Page, conversationId: string, body: string) {
  const status = await page.evaluate(
    async (p) => {
      const r = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...p, clientId: crypto.randomUUID() }),
      });
      return r.status;
    },
    { org: DEMO.org, conversationId, body },
  );
  expect(status).toBe(200);
}

test.describe("chat flutuante", () => {
  test("abrir, conversar, minimizar, restaurar, navegar e fechar sem perder a conversa", async ({ page }) => {
    const token = Date.now().toString(36);
    await login(page, DEMO.owner);
    await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
    await page.goto(ORG);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("chat-dock-button").click();
    const dock = page.getByTestId("chat-dock");
    await expect(dock).toBeVisible();
    if (isMobile(page)) {
      // No celular a janela ocupa a tela inteira.
      const box = (await dock.boundingBox())!;
      expect(box.width).toBe(page.viewportSize()!.width);
    }

    const frame = frameOf(page);
    const dialog = frame.getByRole("dialog");
    // O botão existe antes de o chat da janela hidratar: insiste até a caixa abrir.
    await expect(async () => {
      await frame.getByRole("button", { name: "Nova conversa" }).click({ timeout: 10_000 });
      await expect(dialog).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 60_000 });
    await dialog.getByRole("tab", { name: "Pessoa" }).click();
    await dialog.getByRole("option", { name: /Rafael Nunes/ }).click();
    await dialog.getByRole("button", { name: "Conversar" }).click();
    const composer = frame.getByRole("textbox", { name: "Mensagem" });
    await expect(composer).toBeVisible();
    await composer.fill(`Pela janela ${token}`);
    await composer.press("Enter");
    const sent = frame.getByTestId("chat-message").filter({ hasText: `Pela janela ${token}` });
    await expect(sent).toBeVisible();
    await composer.fill(`Rascunho ${token}`);

    // Minimizar não desmonta o chat; restaurar devolve a conversa e o rascunho.
    await page.getByRole("button", { name: "Minimizar o chat" }).click();
    await expect(dock).toHaveAttribute("data-minimized", "true");
    await expect(page.locator("[data-testid=chat-dock-frame]")).toHaveCount(1);
    await expect(page.locator("[data-testid=chat-dock-frame]")).toBeHidden();
    await page.getByRole("button", { name: "Restaurar o chat" }).first().click();
    await expect(dock).toHaveAttribute("data-minimized", "false");
    await expect(composer).toHaveValue(`Rascunho ${token}`);

    // Trocar de módulo (navegação da própria aplicação) mantém a janela e a conversa.
    await page.getByRole("button", { name: "Minimizar o chat" }).click();
    if (isMobile(page)) await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("link", { name: "Clientes", exact: true }).first().click();
    await page.waitForURL(/\/clients/);
    await expect(dock).toHaveAttribute("data-minimized", "true");
    await page.getByRole("button", { name: "Restaurar o chat" }).first().click();
    await expect(composer).toHaveValue(`Rascunho ${token}`);
    await expect(sent).toBeVisible();

    await page.getByRole("button", { name: "Fechar o chat" }).click();
    await expect(dock).toHaveCount(0);
  });

  test("aviso de mensagem abre a conversa na janela, sobre a página; conversa aberta não gera aviso", async ({
    browser,
  }, info) => {
    const token = Date.now().toString(36);
    const rafael = await person(browser, info, RAFAEL);
    const helena = await person(browser, info, DEMO.owner);
    const conversationId = await directWith(rafael, /Helena Prado/);
    await helena.goto(ORG);
    await helena.waitForLoadState("networkidle");

    await sendAs(rafael, conversationId, `Janela ${token}`);
    const alert = helena.locator(`[data-chat-alert="${conversationId}"]`);
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const read = helena.waitForRequest((r) => r.url().endsWith("/api/chat/read") && r.method() === "POST");
    await alert.getByRole("button", { name: /Abrir conversa/ }).click();
    await expect(helena.getByTestId("chat-dock")).toBeVisible();
    await expect(
      frameOf(helena)
        .getByTestId("chat-message")
        .filter({ hasText: `Janela ${token}` }),
    ).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(helena.url()).pathname).toBe(ORG);
    expect(((await read).postDataJSON() as { conversationId: string }).conversationId).toBe(conversationId);
    await expect(alert).toHaveCount(0);

    // Com a conversa aberta na janela, a mensagem nova entra direto nela, sem aviso.
    await sendAs(rafael, conversationId, `Segunda ${token}`);
    await expect(
      frameOf(helena)
        .getByTestId("chat-message")
        .filter({ hasText: `Segunda ${token}` }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await helena.waitForTimeout(6000);
    await expect(alert).toHaveCount(0);

    await helena.context().close();
    await rafael.context().close();
  });

  test("no editor do Estúdio Criador, o chat abre com o canvas à vista", async ({ page }) => {
    test.skip(isMobile(page), "No celular o editor não tem o botão do chat no cabeçalho (a janela ocupa a tela).");
    await login(page, DEMO.owner);
    await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
    await page.goto(`${ORG}/studio`);
    await page.waitForLoadState("networkidle");
    const href = await page.locator(`ul a[href^="${ORG}/studio/"]`).first().getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
    // O cabeçalho da área da equipe fica atrás do editor: o botão certo é o do editor.
    await page.getByTestId("design-editor").getByTestId("chat-dock-button").click();
    const dock = page.getByTestId("chat-dock");
    await expect(dock).toBeVisible();
    await expect(frameOf(page).getByRole("button", { name: "Nova conversa" })).toBeVisible({ timeout: 60_000 });
    const canvas = (await page.getByTestId("editor-canvas").boundingBox())!;
    const box = (await dock.boundingBox())!;
    // O canvas continua maior que a janela do chat e à vista ao lado dela.
    expect(canvas.width).toBeGreaterThan(box.width);
    expect(box.x).toBeGreaterThan(canvas.x);
    await page.getByRole("button", { name: "Fechar o chat" }).click();
    await expect(dock).toHaveCount(0);
  });

  test("login e páginas públicas não têm chat nem avisos", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
    await expect(page.getByTestId("chat-dock-button")).toHaveCount(0);
    await expect(page.getByTestId("chat-dock")).toHaveCount(0);
    await expect(page.locator("[data-chat-alerts]")).toHaveCount(0);
  });

  test("aviso de evento (comentário numa demanda) abre a demanda certa", async ({ browser }, info) => {
    test.setTimeout(180_000);
    const token = Date.now().toString(36);
    const helena = await person(browser, info, DEMO.owner);
    const rafael = await person(browser, info, RAFAEL);

    // Helena cria uma demanda para si; Rafael comenta nela.
    await helena.goto(`${ORG}/demandas`);
    await helena.waitForLoadState("networkidle");
    await helena.getByRole("button", { name: "Nova demanda" }).first().click();
    const dialog = helena.getByRole("dialog");
    const title = `Aviso e2e ${token}`;
    await dialog.locator("#t-title").fill(title);
    await dialog.locator("#t-project").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Criar", exact: true }).click();
    const link = helena.getByRole("link", { name: title }).first();
    await expect(link).toBeVisible();
    const taskHref = (await link.getAttribute("href"))!;
    await helena.goto(ORG);
    await helena.waitForLoadState("networkidle");

    await rafael.goto(taskHref);
    await rafael.getByLabel("Novo comentário").fill(`Olha isso ${token}`);
    await rafael.getByRole("button", { name: "Comentar" }).click();
    await expect(rafael.getByText(`Olha isso ${token}`)).toBeVisible();

    // O sino consulta a cada 30 s com a aba visível: o aviso aparece sem recarregar a página.
    const alert = helena.locator("[data-event-alert]").filter({ hasText: title });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(alert).toContainText("Novo comentário");
    await expect(alert.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    const read = helena.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
    await alert.getByRole("button", { name: /^Abrir:/ }).click();
    await helena.waitForURL(new RegExp(taskHref.replace(/[/]/g, "\\/")));
    await read;
    await expect(alert).toHaveCount(0);

    await helena.context().close();
    await rafael.context().close();
  });
});

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import sharp from "sharp";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Foto de grupo do chat com duas pessoas em navegadores separados: a Helena
 * (criou o grupo, administra) adiciona, troca e remove a foto; o Rafael
 * (participante) vê as mudanças na lista, no cabeçalho e no aviso sem
 * recarregar, e não consegue alterar. Erros de envio e de conexão não
 * mostram falso "salvo".
 */

const ORG = `/w/${DEMO.org}`;
const RAFAEL = "rafael@demo.aragonez.app";
const PHOTO_SRC = /^\/api\/chat\/photo\/[0-9a-f-]{36}\/[0-9a-f]{32}$/;

async function photo(color: string, width = 800, height = 500) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

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

// Pelo atributo (e não pelo papel): com a janela de recorte aberta, o painel fica oculto para leitores de tela.
const panel = (page: Page) => page.locator('aside[aria-label="Detalhes da conversa"]');
const headerImg = (page: Page) => page.getByTestId("chat-header-details").getByTestId("chat-conversation-photo");

async function openDetails(page: Page) {
  await page.getByTestId("chat-header-details").click();
  await expect(panel(page)).toBeVisible();
}

async function closeDetails(page: Page) {
  await panel(page).getByRole("button", { name: "Fechar detalhes" }).click();
  await expect(panel(page)).toBeHidden();
}

async function savePhoto(page: Page, buffer: Buffer) {
  await panel(page)
    .getByTestId("group-photo-input")
    .setInputFiles({ name: "grupo.jpg", mimeType: "image/jpeg", buffer });
  const dialog = page.getByRole("dialog", { name: "Ajustar foto" });
  await expect(dialog).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/chat/photo") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Salvar foto" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await expect(panel(page).getByTestId("group-photo-status")).toHaveText(/Foto do grupo salva/);
  return (await panel(page).getByTestId("group-photo-current").getAttribute("src"))!;
}

test.describe("foto de grupo do chat", () => {
  test("adicionar, trocar e remover; participantes veem e não podem alterar", async ({ browser }, info) => {
    const mobile = info.project.name === "mobile";
    const token = `${info.project.name}-${Date.now().toString(36)}`;
    const group = `Fotos ${token}`;
    const helena = await person(browser, info, DEMO.owner);
    const rafael = await person(browser, info, RAFAEL);
    const helenaMenuBefore = await helena.getByRole("button", { name: "Menu do perfil" }).innerHTML();

    // Helena cria o grupo com o Rafael.
    await helena.getByRole("button", { name: "Nova conversa" }).first().click();
    const dialog = helena.getByRole("dialog");
    await dialog.getByRole("tab", { name: "Grupo" }).click();
    await dialog.locator("#chat-group-name").fill(group);
    await dialog.getByRole("option", { name: /Rafael Nunes/ }).click();
    await dialog.getByRole("button", { name: "Criar grupo" }).click();
    await helena.waitForURL(/\/chat\/[0-9a-f-]{36}/);
    const conversationId = new URL(helena.url()).pathname.split("/").pop()!;

    // Sem foto: ícone padrão do grupo. O cabeçalho abre os detalhes.
    await expect(helena.getByTestId("chat-header-details").getByTestId("chat-conversation-default-icon")).toBeVisible();
    await openDetails(helena);
    await expect(panel(helena).getByTestId("group-photo-placeholder")).toBeVisible();
    // Participantes e suas permissões.
    await expect(panel(helena).getByRole("listitem").filter({ hasText: "(você)" })).toContainText("Criador(a)");
    await expect(panel(helena).getByRole("listitem").filter({ hasText: "Rafael" })).toContainText("Participante");

    // Arquivo inválido: avisado sem enviar nada.
    await panel(helena)
      .getByTestId("group-photo-input")
      .setInputFiles({ name: "grupo.png", mimeType: "image/png", buffer: Buffer.from("não é imagem") });
    await expect(panel(helena).getByTestId("group-photo-status")).toHaveText(/Não foi possível abrir a imagem/);

    // Falha do servidor e queda de conexão: nada de "salva", foto anterior mantida.
    await panel(helena)
      .getByTestId("group-photo-input")
      .setInputFiles({ name: "grupo.jpg", mimeType: "image/jpeg", buffer: await photo("#c0392b") });
    const crop = helena.getByRole("dialog", { name: "Ajustar foto" });
    await expect(crop.getByRole("img", { name: "Foto em edição" })).toBeVisible();
    await expect(crop.getByText("Lista de conversas, cabeçalho e avisos.")).toBeVisible();
    await crop.getByRole("button", { name: "Aumentar zoom" }).click();
    await helena.route("**/api/chat/photo", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { ok: false, error: "Falha simulada no servidor." } })
        : route.fallback(),
    );
    await crop.getByRole("button", { name: "Salvar foto" }).click();
    await expect(crop.getByRole("alert")).toHaveText(
      /Falha simulada no servidor\. A foto anterior do grupo foi mantida\./,
    );
    await helena.unroute("**/api/chat/photo");
    await helena.route("**/api/chat/photo", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback(),
    );
    await crop.getByRole("button", { name: "Salvar foto" }).click();
    await expect(crop.getByRole("alert")).toHaveText(/Sem conexão com o servidor/);
    await expect(panel(helena).getByTestId("group-photo-status")).not.toHaveText(/Foto do grupo salva/);
    await helena.unroute("**/api/chat/photo");
    await crop.getByRole("button", { name: "Cancelar" }).click();
    await expect(panel(helena).getByTestId("group-photo-placeholder")).toBeVisible();

    // Envio real.
    const first = await savePhoto(helena, await photo("#c0392b"));
    expect(first).toMatch(PHOTO_SRC);
    expect(first).toContain(conversationId);
    if (mobile) await closeDetails(helena);
    await expect(headerImg(helena)).toHaveAttribute("src", first);
    await expect(
      helena.locator("[data-seq]").filter({ hasText: "Helena Prado adicionou a foto do grupo." }),
    ).toBeVisible();

    // Rafael vê a foto na lista sem recarregar, depois no cabeçalho; não pode alterar.
    const row = rafael.getByTestId("chat-conversation").filter({ hasText: group });
    await expect(row.getByTestId("chat-conversation-photo")).toHaveAttribute("src", first, { timeout: 30_000 });
    await row.click();
    await expect(headerImg(rafael)).toHaveAttribute("src", first);
    await openDetails(rafael);
    await expect(panel(rafael).getByText("Só quem administra o grupo pode alterar a foto.")).toBeVisible();
    await expect(panel(rafael).getByRole("button", { name: /Alterar foto|Enviar foto|Remover foto/ })).toHaveCount(0);
    const denied = await rafael.request.post("/api/chat/photo", {
      multipart: {
        org: DEMO.org,
        conversationId,
        file: { name: "x.jpg", mimeType: "image/jpeg", buffer: await photo("#000000", 200, 200) },
      },
    });
    expect(denied.status()).toBe(403);
    expect((await rafael.request.delete("/api/chat/photo", { data: { org: DEMO.org, conversationId } })).status()).toBe(
      403,
    );
    await closeDetails(rafael);

    // Fora do chat, a janela flutuante e o aviso do sino do Rafael mostram a foto atual do grupo.
    await rafael.goto(ORG);
    await rafael.waitForLoadState("networkidle");
    const composer = helena.getByRole("textbox", { name: "Mensagem" });
    await composer.fill(`Veja a capa, @Rafael Nunes! ${token}`);
    await composer.press("Enter");
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Veja a capa` })).toBeVisible();
    const floating = rafael.locator('[aria-label="Notificações de mensagens"]');
    await expect(floating.getByTestId("chat-alert-group-photo")).toHaveAttribute("src", first, { timeout: 30_000 });
    await rafael.getByRole("button", { name: /^Notificações/ }).click();
    const notice = rafael.getByRole("dialog").getByRole("listitem").filter({ hasText: group }).first();
    await expect(notice.getByTestId("chat-conversation-photo")).toHaveAttribute("src", first);
    await rafael.keyboard.press("Escape");

    // Recarregar mantém a foto.
    await rafael.goto(`${ORG}/chat/${conversationId}`);
    await expect(headerImg(rafael)).toHaveAttribute("src", first);
    await rafael.reload();
    await expect(headerImg(rafael)).toHaveAttribute("src", first);

    // Troca: a nova foto chega ao Rafael sem recarregar; a anterior deixa de ser servida.
    if (mobile) await openDetails(helena);
    const second = await savePhoto(helena, await photo("#1f618d", 500, 900));
    expect(second).not.toBe(first);
    await expect(headerImg(rafael)).toHaveAttribute("src", second, { timeout: 30_000 });
    expect((await rafael.request.get(first)).status()).toBe(404);
    expect((await rafael.request.get(second)).status()).toBe(200);

    // Remover: volta ao ícone para todos.
    await panel(helena).getByRole("button", { name: "Remover foto" }).click();
    await helena
      .getByRole("dialog", { name: "Remover a foto do grupo?" })
      .getByRole("button", { name: "Remover foto" })
      .click();
    await expect(panel(helena).getByTestId("group-photo-placeholder")).toBeVisible();
    await expect(rafael.getByTestId("chat-header-details").getByTestId("chat-conversation-default-icon")).toBeVisible({
      timeout: 30_000,
    });
    expect((await rafael.request.get(second)).status()).toBe(404);

    // Foto pessoal da Helena e logo da agência não mudaram.
    if (mobile) await closeDetails(helena);
    expect(await helena.getByRole("button", { name: "Menu do perfil" }).innerHTML()).toBe(helenaMenuBefore);
    await expectNoHorizontalScroll(helena);
    await expectNoHorizontalScroll(rafael);
    await helena.context().close();
    await rafael.context().close();
  });
});

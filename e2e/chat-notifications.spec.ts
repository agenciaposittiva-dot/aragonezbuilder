import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Avisos de mensagens do chat em toda a plataforma: janela flutuante, som e
 * preferências. Duas pessoas em navegadores separados trocam mensagens reais
 * (pela mesma API do chat). O áudio é observado por um "grampo" no
 * AudioContext do navegador de teste — o som em si é o da aplicação; no modo
 * "bloqueado" o navegador de teste se comporta como um que recusa áudio.
 */

const ORG = `/w/${DEMO.org}`;
const RAFAEL = "rafael@demo.aragonez.app";
const SHOTS = process.env.E2E_SHOTS_DIR;

type Audio = "normal" | "blocked";

async function person(browser: Browser, info: TestInfo, email: string, audio: Audio = "normal") {
  const u = info.project.use;
  const context = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
  });
  await context.addInitScript((mode: Audio) => {
    // O selo do `next dev` cobre controles no celular.
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.append(style);
    });
    const w = window as unknown as { __tones: number[]; AudioContext: typeof AudioContext };
    w.__tones = [];
    const Base = w.AudioContext;
    class Recorded extends Base {
      override createOscillator() {
        const osc = super.createOscillator();
        const start = osc.start.bind(osc);
        osc.start = (when?: number) => {
          w.__tones.push(osc.frequency.value);
          start(when);
        };
        return osc;
      }
    }
    if (mode === "blocked") {
      Object.defineProperty(Recorded.prototype, "state", { get: () => "suspended" });
      Recorded.prototype.resume = () => Promise.resolve();
    }
    w.AudioContext = Recorded;
  }, audio);
  const page = await context.newPage();
  await login(page, email);
  await page.waitForURL((url) => url.pathname === "/" || url.pathname.startsWith("/w/"), { timeout: 60_000 });
  return page;
}

/** Toques do aviso de mensagem (880 Hz) e do aviso reduzido (740 Hz). */
async function tones(page: Page) {
  const all = await page.evaluate(() => (window as unknown as { __tones: number[] }).__tones);
  return { message: all.filter((f) => f === 880).length, soft: all.filter((f) => f === 740).length };
}

/** Uma interação qualquer com a página (o navegador só libera áudio depois disso). */
async function interact(page: Page) {
  await page.locator("main#conteudo").click({ position: { x: 4, y: 4 } });
}

async function openAt(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** Abre (ou cria) a conversa direta com alguém, pela interface, e devolve o id. */
async function directWith(page: Page, name: RegExp) {
  await openAt(page, `${ORG}/chat`);
  await page.getByRole("button", { name: "Nova conversa" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Pessoa" }).click();
  await dialog.getByRole("option", { name }).click();
  await dialog.getByRole("button", { name: "Conversar" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function groupWith(page: Page, groupName: string, name: RegExp) {
  await openAt(page, `${ORG}/chat`);
  await page.getByRole("button", { name: "Nova conversa" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Grupo" }).click();
  await dialog.locator("#chat-group-name").fill(groupName);
  await dialog.getByRole("option", { name }).click();
  await dialog.getByRole("button", { name: "Criar grupo" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** Envia pela mesma API que o compositor do chat usa (mensagem real, gravada no banco). */
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

function card(page: Page, conversationId: string) {
  return page.locator(`[data-chat-alert="${conversationId}"]`);
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/avisos-${info.project.name}-${name}.png` });
}

async function setSound(page: Page, on: boolean) {
  await openAt(page, `${ORG}/account#avisos-chat`);
  const sw = page.getByRole("switch", { name: "Tocar som para mensagens recebidas" });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await page.getByRole("button", { name: "Salvar avisos" }).click();
  await expect(page.getByText("Avisos de mensagens salvos")).toBeVisible();
}

test.describe("avisos de mensagens do chat", () => {
  test("chat fechado: janela flutuante e som; clique abre a conversa certa e marca como lida", async ({
    browser,
  }, info) => {
    const token = Date.now().toString(36);
    const rafael = await person(browser, info, RAFAEL);
    const helena = await person(browser, info, DEMO.owner);
    const conversationId = await directWith(rafael, /Helena Prado/);

    // Helena está no painel (chat fechado) e já interagiu com a página.
    await openAt(helena, ORG);
    await interact(helena);
    await sendAs(rafael, conversationId, `Oi Helena, a arte ${token} está pronta`);

    const alert = card(helena, conversationId);
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText("Rafael Nunes");
    await expect(alert).toContainText(`a arte ${token} está pronta`);
    await expect(alert.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
    await expect.poll(async () => (await tones(helena)).message).toBe(1);
    // Quem envia não ouve o próprio aviso.
    expect((await tones(rafael)).message).toBe(0);

    // Dentro dos limites da tela, abaixo do cabeçalho e sem deslocar a página.
    const box = (await alert.boundingBox())!;
    const vp = helena.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y).toBeGreaterThanOrEqual(56);
    await expectNoHorizontalScroll(helena);
    await shot(helena, info, "janela");

    // Clique: abre exatamente esta conversa e marca como lida (regra do chat).
    const read = helena.waitForRequest((r) => r.url().endsWith("/api/chat/read") && r.method() === "POST");
    await alert.getByRole("button", { name: /Abrir conversa/ }).click();
    await helena.waitForURL(new RegExp(`/chat/${conversationId}$`));
    await expect(helena.getByTestId("chat-message").filter({ hasText: `a arte ${token}` })).toBeVisible();
    const body = (await read).postDataJSON() as { conversationId: string };
    expect(body.conversationId).toBe(conversationId);
    await expect(alert).toHaveCount(0);

    await helena.context().close();
    await rafael.context().close();
  });

  test("dispensar não apaga a mensagem; várias mensagens são agrupadas, sem sobreposição e sem som repetido", async ({
    browser,
  }, info) => {
    const token = Date.now().toString(36);
    const rafael = await person(browser, info, RAFAEL);
    const helena = await person(browser, info, DEMO.owner);
    const direct = await directWith(rafael, /Helena Prado/);
    const group = await groupWith(rafael, `Avisos ${token}`, /Helena Prado/);

    await openAt(helena, `${ORG}/tasks`);
    await interact(helena);
    await sendAs(rafael, direct, `Primeira ${token}`);
    await sendAs(rafael, direct, `Segunda ${token}`);
    await sendAs(rafael, direct, `Terceira ${token}`);
    await sendAs(rafael, group, `No grupo ${token}`);

    const d = card(helena, direct);
    const g = card(helena, group);
    await expect(d).toContainText(`Terceira ${token}`, { timeout: 20_000 });
    await expect(d).toContainText("3 mensagens novas");
    await expect(g).toBeVisible();
    await expect(g).toContainText(`Avisos ${token}`);
    await expect(helena.locator("[data-chat-alert]")).toHaveCount(2);
    // Uma janela por conversa, uma abaixo da outra.
    const [a, b] = [(await d.boundingBox())!, (await g.boundingBox())!];
    const overlap = !(a.y + a.height <= b.y || b.y + b.height <= a.y);
    expect(overlap).toBe(false);
    // Quatro mensagens em sequência: no máximo dois toques (agrupados), nunca um por mensagem.
    const heard = (await tones(helena)).message;
    expect(heard).toBeGreaterThanOrEqual(1);
    expect(heard).toBeLessThanOrEqual(2);
    await shot(helena, info, "agrupadas");

    // Mais uma na mesma conversa logo em seguida: atualiza a janela sem tocar de novo.
    // O mouse sobre a janela pausa o fechamento automático (8 s), como acontece com quem está lendo.
    await d.hover();
    await sendAs(rafael, direct, `Quarta ${token}`);
    await expect(d).toContainText("4 mensagens novas", { timeout: 20_000 });
    expect((await tones(helena)).message).toBe(heard);

    // Dispensar: a janela some, a mensagem continua no chat (e não lida).
    await d.getByRole("button", { name: "Dispensar notificação" }).click();
    await expect(d).toHaveCount(0);
    await g.getByRole("button", { name: /Abrir conversa/ }).focus();
    await helena.keyboard.press("Escape");
    await expect(g).toHaveCount(0);
    await openAt(helena, `${ORG}/chat`);
    const row = helena.getByTestId("chat-conversation").filter({ hasText: "Rafael Nunes" }).first();
    await expect(row.getByLabel(/não lidas/)).toBeVisible();
    await row.click();
    for (const t of ["Primeira", "Segunda", "Terceira", "Quarta"]) {
      await expect(helena.getByTestId("chat-message").filter({ hasText: `${t} ${token}` })).toBeVisible();
    }

    await helena.context().close();
    await rafael.context().close();
  });

  test("reconexão e recarga não repetem avisos; conversa aberta entra no chat sem janela", async ({
    browser,
  }, info) => {
    const token = Date.now().toString(36);
    const rafael = await person(browser, info, RAFAEL);
    const helena = await person(browser, info, DEMO.owner);
    const direct = await directWith(rafael, /Helena Prado/);

    await openAt(helena, `${ORG}/projects`);
    await interact(helena);
    await sendAs(rafael, direct, `Antes da queda ${token}`);
    const d = card(helena, direct);
    await expect(d).toBeVisible({ timeout: 20_000 });

    // Sem conexão: a mensagem enviada nesse meio-tempo chega uma única vez ao voltar.
    await helena.context().setOffline(true);
    await sendAs(rafael, direct, `Durante a queda ${token}`);
    await helena.waitForTimeout(5000);
    await helena.context().setOffline(false);
    await expect(d).toContainText(`Durante a queda ${token}`, { timeout: 20_000 });
    await expect(d).toContainText("2 mensagens novas");
    // Mais alguns ciclos de consulta (com a margem de reconexão): nada duplica. Com o mouse
    // sobre a janela (lendo), ela não fecha sozinha.
    await d.hover();
    await helena.waitForTimeout(10_000);
    await expect(d).toContainText("2 mensagens novas");
    await expect(helena.locator("[data-chat-alert]")).toHaveCount(1);

    // Recarregar a página não traz de volta avisos de mensagens antigas.
    const before = (await tones(helena)).message;
    expect(before).toBeLessThanOrEqual(2);
    await helena.reload();
    await helena.waitForLoadState("networkidle");
    await helena.waitForTimeout(6000);
    await expect(helena.locator("[data-chat-alert]")).toHaveCount(0);
    expect((await tones(helena)).message).toBe(0);

    // Conversa aberta e visível: a mensagem entra no chat, sem janela, com som reduzido (padrão).
    await openAt(helena, `${ORG}/chat/${direct}`);
    await helena.getByRole("textbox", { name: "Mensagem" }).click();
    await sendAs(rafael, direct, `Com a conversa aberta ${token}`);
    await expect(helena.getByTestId("chat-message").filter({ hasText: `Com a conversa aberta ${token}` })).toBeVisible({
      timeout: 15_000,
    });
    await helena.waitForTimeout(5000);
    await expect(helena.locator("[data-chat-alert]")).toHaveCount(0);
    expect((await tones(helena)).message).toBe(0);
    expect((await tones(helena)).soft).toBeLessThanOrEqual(1);

    await helena.context().close();
    await rafael.context().close();
  });

  test("configurações: testar o som, desligar o som e áudio bloqueado pelo navegador", async ({ browser }, info) => {
    const token = Date.now().toString(36);
    const rafael = await person(browser, info, RAFAEL);
    const helena = await person(browser, info, DEMO.owner);
    const direct = await directWith(rafael, /Helena Prado/);

    // Testar o som nas configurações.
    await openAt(helena, `${ORG}/account#avisos-chat`);
    const section = helena.locator("#avisos-chat");
    await expect(section.getByRole("heading", { name: "Avisos de mensagens" })).toBeVisible();
    await section.getByRole("button", { name: "Testar som" }).click();
    await expect(section.getByRole("status")).toContainText("Som tocado");
    expect((await tones(helena)).message).toBe(1);
    await expectNoHorizontalScroll(helena);
    await shot(helena, info, "configuracoes");

    try {
      // Som desligado: a janela aparece, nenhum toque.
      await setSound(helena, false);
      await openAt(helena, ORG);
      await interact(helena);
      const before = (await tones(helena)).message;
      await sendAs(rafael, direct, `Sem som ${token}`);
      await expect(card(helena, direct)).toContainText(`Sem som ${token}`, { timeout: 20_000 });
      await helena.waitForTimeout(1500);
      expect((await tones(helena)).message).toBe(before);
    } finally {
      await setSound(helena, true);
    }

    // Navegador que bloqueia áudio: nenhum erro técnico, só a orientação e o botão "Ativar som".
    const blocked = await person(browser, info, DEMO.owner, "blocked");
    await openAt(blocked, ORG);
    await interact(blocked);
    await sendAs(rafael, direct, `Bloqueado ${token}`);
    const alert = card(blocked, direct);
    await expect(alert).toContainText(`Bloqueado ${token}`, { timeout: 20_000 });
    await expect(alert).toContainText("O navegador bloqueou o som deste site");
    await alert.getByRole("button", { name: "Ativar som" }).click();
    await expect(alert).toContainText("Libere o som nas permissões do site");
    expect((await tones(blocked)).message).toBe(0);
    await shot(blocked, info, "som-bloqueado");
    await openAt(blocked, `${ORG}/account#avisos-chat`);
    await blocked.locator("#avisos-chat").getByRole("button", { name: "Testar som" }).click();
    await expect(blocked.locator("#avisos-chat").getByRole("status")).toContainText("O navegador bloqueou o som");

    await blocked.context().close();
    await helena.context().close();
    await rafael.context().close();
  });
});

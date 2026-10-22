import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Client } from "pg";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Chat de edição de artes por IA (provedor de demonstração, determinístico):
 * no editor e no Assistente IA, no computador e no celular. Cobre os testes de
 * aceitação: frase existente, ortografia sem tocar no resto, nova versão de
 * imagem, slide específico, cancelar, desfazer, reabrir salvo, provedor fora
 * do ar e falha ao salvar, bloqueio sem permissão e o editor seguindo normal.
 *
 * O conteúdo inicial das artes é gravado direto no banco (E2E_ENV_FILE aponta
 * o .env com DATABASE_OWNER_URL), como no teste da arte antiga do editor.
 */

const ORG = `/w/${DEMO.org}`;
const IMAGE = path.join(__dirname, "fixtures", "foto-editor.png");
const CHECKPOINT = "Antes da edição pelo chat de IA";

type Obj = { id: string; type: string; text?: string; src?: string } & Record<string, unknown>;
type Doc = { pages: { id: string; objects: Obj[] }[] } & Record<string, unknown>;

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 1024;

async function enter(page: Page, email = DEMO.owner) {
  // Em `next dev` o selo das ferramentas de desenvolvimento cobre a barra inferior do editor no celular.
  await page.context().addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  await login(page, email);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

const editorReady = (page: Page) => expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });

async function newDesign(page: Page, name: string, preset = "ig-square", pages?: number) {
  await page.goto(`${ORG}/studio`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nova arte" }).first().click();
  await page.fill("#d-name", name);
  await page.selectOption("#d-preset", preset);
  if (pages) await page.fill("#d-pages", String(pages));
  await page.getByRole("button", { name: "Criar e abrir editor" }).click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await editorReady(page);
  return page.url().split("/").at(-1)!;
}

const doc = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { doc: unknown } } }).__designEditor.store.doc,
  ) as Promise<Doc>;
const find = async (page: Page, id: string) =>
  (await doc(page)).pages.flatMap((p) => p.objects).find((o) => o.id === id);
const textOf = async (page: Page, id: string) => (await find(page, id))?.text;

const text = (id: string, name: string, value: string, y: number, fontSize: number) => ({
  id,
  type: "text",
  name,
  x: 90,
  y,
  width: 900,
  height: Math.round(fontSize * 1.2),
  rotation: 0,
  opacity: 1,
  text: value,
  fontFamily: "Inter",
  fontSize,
  fontWeight: 700,
  fontStyle: "normal",
  textAlign: "left",
  lineHeight: 1.2,
  letterSpacing: 0,
  color: "#121110",
});

/** Grava o conteúdo inicial (textos com erros de digitação) nas páginas da arte recém-criada. */
async function seedTexts(page: Page, id: string) {
  const d = await doc(page);
  const contents = [
    [text("t1", "Título", "Promocao imperdivel", 120, 80), text("t2", "Apoio", "Texto já correto.", 320, 36)],
    [text("t3", "Título 2", "Voce vai amar", 120, 72), text("t4", "Rodapé", "Arraste para o lado", 900, 28)],
    [text("t5", "CTA", "Fale com a gente", 120, 64)],
  ];
  const next = { ...d, pages: d.pages.map((p, i) => ({ ...p, objects: contents[i] ?? [] })) };
  const env = config({ path: process.env.E2E_ENV_FILE ?? ".env", processEnv: {}, quiet: true }).parsed ?? {};
  const db = new Client({ connectionString: env.DATABASE_OWNER_URL || env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("set app.rls_bypass = on");
    await db.query("update designs set document = $1, revision = revision + 1 where id = $2", [next, id]);
  } finally {
    await db.end();
  }
  await page.reload();
  await editorReady(page);
  expect(await textOf(page, "t1")).toBe("Promocao imperdivel");
}

/** Abre o chat: painel ao lado do canvas no computador, gaveta no celular. */
async function openChat(page: Page): Promise<Locator> {
  if (isMobile(page)) {
    await page.getByRole("navigation", { name: "Ferramentas" }).getByTestId("mobile-design-ai").click();
  } else {
    await page.getByTestId("open-design-ai").click();
  }
  const chat = page.getByTestId("design-ai-chat");
  await expect(chat).toBeVisible();
  await expect(chat.getByText("Modo demonstração")).toBeVisible();
  return chat;
}

async function closeChatOnMobile(page: Page) {
  if (!isMobile(page)) return;
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Fechar" }).click();
  await expect(dlg).toBeHidden();
}

/** Envia com Enter (Shift+Enter quebra a linha) e devolve a última proposta. */
async function ask(chat: Locator, message: string) {
  const input = chat.getByTestId("design-ai-input");
  await input.fill(message);
  await input.press("Enter");
  await expect(chat.getByTestId("design-ai-running")).toBeHidden({ timeout: 30_000 });
  const proposal = chat.getByTestId("design-ai-proposal").last();
  await expect(proposal).toBeVisible();
  return proposal;
}

const status = (proposal: Locator) => proposal.getAttribute("data-status");

test.describe("chat de edição de artes por IA", () => {
  test("no editor: ortografia, frase de um slide, cancelar, aplicar, desfazer e reabrir salvo", async ({ page }) => {
    await enter(page);
    const id = await newDesign(page, `Chat IA ${Date.now().toString(36)}`, "carousel-square", 3);
    await seedTexts(page, id);
    await expectNoHorizontalScroll(page);
    let chat = await openChat(page);

    // Shift+Enter não envia (quebra a linha).
    const input = chat.getByTestId("design-ai-input");
    await input.fill("linha 1");
    await input.press("Shift+Enter");
    await expect(input).toHaveValue("linha 1\n");
    await expect(chat.getByTestId("design-ai-proposal")).toHaveCount(0);

    // 2. Ortografia: prévia antes/depois só dos textos com erro (das 3 páginas).
    let proposal = await ask(chat, "Corrija os erros de português");
    await expect(proposal.getByTestId("design-ai-change")).toHaveCount(2);
    await expect(proposal.getByTestId("design-ai-before").first()).toHaveText("Promocao imperdivel");
    await expect(proposal.getByTestId("design-ai-after").first()).toHaveText("Promoção imperdível");
    await expect(proposal.getByTestId("design-ai-preview").first().locator("img")).toHaveCount(2);

    // 5. Cancelar mantém o original.
    await proposal.getByTestId("design-ai-cancel").click();
    await expect.poll(() => status(proposal)).toBe("cancelled");
    expect(await textOf(page, "t1")).toBe("Promocao imperdivel");

    // Aplicar: “Aplicando…” → “Salvo” só depois do servidor; os outros elementos não mudam.
    const untouched = await Promise.all(["t2", "t4", "t5"].map((x) => find(page, x)));
    proposal = await ask(chat, "Corrija os erros de português");
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");
    await expect(proposal.getByTestId("design-ai-status")).toHaveText("Salvo");
    await expect(page.locator("[data-save-state]").first()).toHaveAttribute("data-save-state", "saved");
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");
    expect(await textOf(page, "t3")).toBe("Você vai amar");
    expect(await Promise.all(["t2", "t4", "t5"].map((x) => find(page, x)))).toEqual(untouched);

    // 1 + 4. Frase existente de um slide específico.
    proposal = await ask(chat, "Troque o título do slide 2 por uma frase mais impactante");
    await expect(proposal.getByText("Página 2", { exact: true })).toBeVisible();
    await expect(proposal.getByTestId("design-ai-after")).toHaveText("Agora é a sua vez: Você vai amar!");
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");
    expect(await textOf(page, "t3")).toBe("Agora é a sua vez: Você vai amar!");
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");

    // 6. Desfazer a alteração aplicada.
    await proposal.getByTestId("design-ai-undo").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("undone");
    expect(await textOf(page, "t3")).toBe("Você vai amar");
    await expect(page.locator("[data-save-state]").first()).toHaveAttribute("data-save-state", "saved", {
      timeout: 30_000,
    });

    // 7. Reabrir: o que foi salvo continua; a versão anterior está no histórico.
    await page.reload();
    await editorReady(page);
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");
    expect(await textOf(page, "t3")).toBe("Você vai amar");
    await page.getByRole("button", { name: "Histórico de versões" }).click();
    await expect(page.getByTestId("design-versions").getByText(CHECKPOINT).first()).toBeVisible();
    await page.keyboard.press("Escape");

    // O histórico da conversa desta arte fica disponível ao reabrir.
    chat = await openChat(page);
    await chat.getByRole("button", { name: /Anteriores/ }).click();
    await expect(chat.getByTestId("design-ai-history")).toContainText("Troque o título do slide 2");
    await closeChatOnMobile(page);

    // 10. O editor continua funcionando: desfazer/refazer do próprio editor.
    if (!isMobile(page)) {
      await page.getByRole("button", { name: "Fechar chat" }).click();
      await expect(page.getByTestId("properties-panel")).toBeVisible();
    }
  });

  test("nova versão de uma imagem existente: arquivo novo em Arquivos e só a imagem troca", async ({ page }) => {
    await enter(page);
    await newDesign(page, `Chat imagem ${Date.now().toString(36)}`);
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(IMAGE);
    await expect.poll(async () => (await doc(page)).pages[0]!.objects.length, { timeout: 30_000 }).toBe(1);
    const original = (await doc(page)).pages[0]!.objects[0]!;
    expect(original.src).toMatch(/^\/api\/files\//);
    await expect(page.locator("[data-save-state]").first()).toHaveAttribute("data-save-state", "saved", {
      timeout: 30_000,
    });

    const chat = await openChat(page);
    const proposal = await ask(chat, "Gere uma nova versão desta imagem mais premium");
    const block = proposal.getByTestId("design-ai-image");
    await expect(block).toBeVisible();
    await block.getByTestId("design-ai-image-generate").click();
    await expect(block.getByTestId("design-ai-image-result")).toBeVisible({ timeout: 30_000 });
    await expect(block).toContainText("modo demonstração");
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");
    const after = (await doc(page)).pages[0]!.objects;
    expect(after).toHaveLength(1); // nada foi achatado ou acrescentado
    expect(after[0]!.id).toBe(original.id);
    expect(after[0]!.src).toMatch(/^\/api\/files\//);
    expect(after[0]!.src).not.toBe(original.src);
    // A original continua disponível.
    expect((await page.request.get(original.src!)).ok()).toBe(true);

    await page.reload();
    await editorReady(page);
    expect((await doc(page)).pages[0]!.objects[0]!.src).toBe(after[0]!.src);
  });

  test("provedor fora do ar e falha ao salvar: nunca mostra sucesso antes de gravar", async ({ page }) => {
    await enter(page);
    const id = await newDesign(page, `Chat falhas ${Date.now().toString(36)}`, "carousel-square", 3);
    await seedTexts(page, id);
    const chat = await openChat(page);

    // 8a. Provedor indisponível: erro claro, nada muda, dá para tentar de novo.
    await page.route("**/api/designs/ai", (route) =>
      route.fulfill({
        status: 502,
        json: {
          ok: false,
          error: "O provedor de IA está indisponível no momento.",
          code: "provider_error",
          retryable: true,
        },
      }),
    );
    const input = chat.getByTestId("design-ai-input");
    await input.fill("Corrija os erros de português");
    await input.press("Enter");
    await expect(chat.getByRole("alert").filter({ hasText: "indisponível" })).toBeVisible();
    expect(await textOf(page, "t1")).toBe("Promocao imperdivel");
    await page.unroute("**/api/designs/ai");
    await chat.getByRole("button", { name: "Tentar de novo" }).click();
    const proposal = chat.getByTestId("design-ai-proposal").last();
    await expect(proposal).toBeVisible({ timeout: 30_000 });

    // 8b. Falha ao salvar: a alteração fica na arte, o estado é “Erro ao salvar” e dá para tentar de novo.
    let actions = 0;
    const pages = (url: URL) => url.pathname.startsWith("/w/");
    await page.route(pages, (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        actions++;
        // 1ª chamada: ponto de restauração (passa); a seguinte é o salvamento da arte (cai).
        if (actions >= 2) return route.abort("internetdisconnected");
      }
      return route.continue();
    });
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("unsaved");
    await expect(proposal.getByTestId("design-ai-status")).toHaveText("Erro ao salvar");
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");
    await page.unroute(pages);
    await proposal.getByTestId("design-ai-retry-save").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");
    await page.reload();
    await editorReady(page);
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");
  });

  test("Assistente IA: escolher a arte, aplicar no servidor, desfazer e abrir no editor", async ({ page }) => {
    await enter(page);
    const name = `Chat assistente ${Date.now().toString(36)}`;
    const id = await newDesign(page, name, "carousel-square", 3);
    await seedTexts(page, id);

    await page.goto(`${ORG}/ai`);
    const section = page.getByTestId("design-ai-section");
    await section.scrollIntoViewIfNeeded();
    await section.getByLabel("Buscar arte").fill(name);
    await section.getByTestId("design-ai-target").first().click();
    await expect(section.getByTestId("design-ai-selected")).toHaveText(name);
    await expectNoHorizontalScroll(page);
    const chat = section.getByTestId("design-ai-chat");
    await expect(chat.getByText("Carrossel com 3 páginas", { exact: false })).toBeVisible();

    let proposal = await ask(chat, "Troque o título do slide 3 por uma frase mais impactante");
    await expect(proposal.getByTestId("design-ai-after")).toHaveText("Agora é a sua vez: Fale com a gente!");
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");
    await proposal.getByTestId("design-ai-undo").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("undone");

    proposal = await ask(chat, "Corrija os erros de português");
    await proposal.getByTestId("design-ai-apply").click();
    await expect.poll(() => status(proposal), { timeout: 30_000 }).toBe("saved");

    await page.goto(`${ORG}/studio/${id}`);
    await editorReady(page);
    expect(await textOf(page, "t1")).toBe("Promoção imperdível");
    expect(await textOf(page, "t5")).toBe("Fale com a gente");
  });

  test("sem permissão de editar artes: sem chat e a API recusa", async ({ page }) => {
    // Atendimento (Rafael): usa a IA, mas não edita artes.
    await enter(page, "rafael@demo.aragonez.app");
    await page.goto(`${ORG}/studio`);
    await page.waitForLoadState("networkidle");
    const href = await page.locator(`a[href^="${ORG}/studio/"]`).first().getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(href!);
    await editorReady(page);
    await expect(page.getByTestId("open-design-ai")).toHaveCount(0);
    await expect(page.getByTestId("mobile-design-ai")).toHaveCount(0);
    const designId = href!.split("/").at(-1)!;
    const res = await page.evaluate(
      async ([org, id]) => {
        const r = await fetch("/api/designs/ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgSlug: org, designId: id, message: "Corrija os erros de português" }),
        });
        return { status: r.status, body: (await r.json()) as { error?: string } };
      },
      [DEMO.org, designId] as const,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/permissão/);
    await page.goto(`${ORG}/ai`);
    await expect(page.getByRole("heading", { name: "Criação com IA" })).toBeVisible();
    await expect(page.getByTestId("design-ai-section")).toHaveCount(0);
  });
});

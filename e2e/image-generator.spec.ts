import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Gerar imagem dentro do editor (Estúdio Criador), no computador e no celular.
 *
 * 1. Painel integrado com a agência de demonstração: estados vazio, descrição,
 *    "Melhorar com IA" (demonstração local), formato, modelo de imagem
 *    indisponível (a demonstração não gera imagens) e dados preservados ao
 *    fechar e reabrir o painel.
 * 2. Fluxo de inserção com a rota de geração simulada NO NAVEGADOR
 *    (page.route): o servidor real é coberto por tests/design-image-gen.test.ts
 *    com a Images API simulada. As "imagens geradas" são arquivos reais de
 *    Arquivos, enviados pelo próprio editor; assim a inserção, o fundo, a
 *    substituição, o salvamento e a reabertura acontecem de verdade.
 */

const ORG = `/w/${DEMO.org}`;
const IMAGE = path.join(__dirname, "fixtures", "foto-editor.png");
const PROMPT = "Frasco de perfume premium sobre mármore preto com iluminação cinematográfica";
const FILE_ID = "00000000-0000-4000-8000-000000000000";

type Obj = { id: string; type: string; name: string; x: number; y: number; width: number; height: number } & Record<
  string,
  unknown
>;
type Doc = { pages: { id: string; name: string; objects: Obj[] }[] };

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 1024;

async function enter(page: Page) {
  // Em `next dev` o selo das ferramentas de desenvolvimento cobre a barra inferior do editor no celular.
  await page.context().addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

const editorReady = (page: Page) => expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });

async function newDesign(page: Page, name: string, preset: string, pages: number) {
  await page.goto(`${ORG}/studio`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Nova arte" }).first().click();
  await page.fill("#d-name", name);
  await page.selectOption("#d-preset", preset);
  await page.fill("#d-pages", String(pages));
  await page.getByRole("button", { name: "Criar e abrir editor" }).click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await editorReady(page);
}

const doc = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { doc: unknown } } }).__designEditor.store.doc,
  ) as Promise<Doc>;
const objects = async (page: Page, pageIndex = 0) => (await doc(page)).pages[pageIndex]!.objects;
const images = async (page: Page, pageIndex = 0) => (await objects(page, pageIndex)).filter((o) => o.type === "image");
const selection = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { selection: string[] } } }).__designEditor.store.selection,
  );

const indicator = (page: Page) => page.locator("[data-save-state]").first();
async function waitServerSave(page: Page) {
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 });
}

async function closeSheet(page: Page) {
  if (!isMobile(page)) return;
  const dlg = page.getByRole("dialog");
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.getByRole("button", { name: "Fechar" }).click();
    await expect(dlg).toBeHidden();
  }
}

/** Abre o painel Gerar imagem: pela seção Imagens de Fotos (celular) ou pelo trilho (computador). */
async function openGenerator(page: Page): Promise<Locator> {
  if (isMobile(page)) {
    await closeSheet(page);
    await page
      .getByRole("navigation", { name: "Ferramentas" })
      .getByRole("button", { name: "Imagem", exact: true })
      .click();
    const dlg = page.getByRole("dialog");
    await dlg.getByTestId("open-image-generator").click();
    await expect(dlg.getByTestId("image-generator")).toBeVisible();
    return dlg;
  }
  await page
    .getByRole("navigation", { name: "Painéis do editor" })
    .getByRole("button", { name: "Gerar imagem", exact: true })
    .click();
  const panel = page.getByTestId("editor-left-panel");
  await expect(panel.getByTestId("image-generator")).toBeVisible();
  return panel;
}

/** Fecha o painel: gaveta no celular; no computador, abre outro painel no lugar. */
async function closeGenerator(page: Page) {
  if (isMobile(page)) return closeSheet(page);
  await page
    .getByRole("navigation", { name: "Painéis do editor" })
    .getByRole("button", { name: "Fotos", exact: true })
    .click();
  await expect(page.getByTestId("editor-left-panel").getByTestId("image-generator")).toHaveCount(0);
}

/** Ativa uma página pelo painel de Camadas (clique no nome, à esquerda das ações que aparecem no hover). */
async function activatePage(page: Page, name: string) {
  const row = (root: Locator) => root.getByTestId("pages-list").getByRole("button", { name: new RegExp(`^${name}`) });
  if (isMobile(page)) {
    await closeSheet(page);
    await page
      .getByRole("navigation", { name: "Ferramentas" })
      .getByRole("button", { name: "Camadas", exact: true })
      .click();
    const dlg = page.getByRole("dialog");
    await row(dlg).click({ position: { x: 8, y: 8 } });
    await closeSheet(page);
    return;
  }
  await page
    .getByRole("navigation", { name: "Painéis do editor" })
    .getByRole("button", { name: "Camadas", exact: true })
    .click();
  await row(page.getByTestId("editor-left-panel")).click({ position: { x: 8, y: 8 } });
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

test.describe("gerar imagem no editor", () => {
  test("painel integrado: descrição, melhorar com IA, formato, modelo indisponível e dados preservados", async ({
    page,
  }) => {
    await enter(page);
    await newDesign(page, `Gerar imagem ${Date.now().toString(36)}`, "carousel-square", 3);
    let gen = await openGenerator(page);
    await expect(gen.getByTestId("image-generator-where")).toHaveText("Slide 1 de 3");
    await expect(gen.getByTestId("image-generator-model")).toBeVisible({ timeout: 30_000 });
    const generate = gen.getByTestId("image-generator-generate");
    // 2. Painel aberto e vazio: nada para gerar.
    await expect(generate).toBeDisabled();

    // 3. Descrição preenchida + "Melhorar com IA" (demonstração): preserva o texto e explica.
    const prompt = gen.getByTestId("image-generator-prompt");
    await prompt.fill(PROMPT);
    await expect(generate).toBeEnabled();
    await gen.getByTestId("image-generator-enhance").click();
    await expect(prompt).toHaveValue(/Exemplo da demonstração/, { timeout: 30_000 });
    expect((await prompt.inputValue()).startsWith(PROMPT)).toBe(true);
    await expect(toast(page, "Descrição melhorada")).toBeVisible();
    await gen.getByTestId("image-generator-undo-enhance").click();
    await expect(prompt).toHaveValue(PROMPT);

    // Formato claramente exibido (com as medidas finais só quando há provedor de imagem).
    await gen.getByRole("radio", { name: "Formato Retrato para feed 4:5" }).click();
    await expect(gen.getByTestId("image-generator-format")).toContainText("Retrato para feed 4:5");
    await gen.getByRole("radio", { name: "Formato Formato do slide" }).click();
    await expect(gen.getByTestId("image-generator-format")).toContainText("Formato do slide 1:1");

    // 9. Modelo indisponível: a demonstração local não gera imagens — aviso no painel e recusa do servidor.
    await expect(gen.getByTestId("image-generator-model")).toContainText(/não gera imagens|compatível/);
    await generate.click();
    const error = gen.getByTestId("image-generator-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/Gerar imagens|gpt-image/);

    // 7. Biblioteca vazia (nenhuma imagem gerada ainda).
    await gen.getByTestId("image-generator-library-toggle").click();
    await expect(gen.getByTestId("image-generator-library")).toContainText("Nenhuma imagem gerada");

    // 13. Fechar e reabrir: descrição, formato e estado continuam.
    await closeGenerator(page);
    gen = await openGenerator(page);
    await expect(gen.getByTestId("image-generator-prompt")).toHaveValue(PROMPT);
    await expect(gen.getByTestId("image-generator-format")).toContainText("Formato do slide 1:1");
    await expect(gen.getByTestId("image-generator-error")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("inserir no slide atual, como fundo e substituir; cancelar, erro e descartar; salvar e reabrir", async ({
    page,
  }) => {
    await enter(page);
    await newDesign(page, `Inserir IA ${Date.now().toString(36)}`, "carousel-square", 2);

    // Dois arquivos reais em Arquivos (enviados pelo editor) fazem o papel das imagens geradas.
    const fileInput = page.locator('input[type=file][accept="image/*"]');
    await fileInput.setInputFiles(IMAGE);
    await expect.poll(async () => (await images(page)).length, { timeout: 30_000 }).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    await fileInput.setInputFiles(IMAGE);
    await expect.poll(async () => (await images(page)).length, { timeout: 30_000 }).toBe(2);
    const [srcA, srcB] = (await images(page)).map((o) => String(o.src)) as [string, string];
    expect(srcA).not.toBe(srcB);
    // Remove os elementos enviados (os arquivos continuam em Arquivos): a arte começa limpa.
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await images(page)).length).toBe(1);
    const remaining = (await images(page))[0]!.id;
    await page.evaluate(
      (id) =>
        (
          window as unknown as { __designEditor: { store: { setSelection(ids: string[]): void } } }
        ).__designEditor.store.setSelection([id]),
      remaining,
    );
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await images(page)).length).toBe(0);

    const versionOf = (src: string) => src.split("/").at(-1)!;
    const result = (srcs: string[]) => ({
      ok: true,
      result: {
        generationId: FILE_ID,
        provider: "openai",
        providerLabel: "OpenAI (ChatGPT)",
        model: "gpt-image-1",
        modelLabel: "gpt-image-1",
        prompt: PROMPT,
        finalPrompt: PROMPT,
        format: "page",
        ratio: "1:1",
        contextUsed: false,
        pageId: null,
        images: srcs.map((src) => ({ fileId: FILE_ID, versionId: versionOf(src), src, width: 480, height: 320 })),
        warnings: [],
        notice: null,
        usage: { inputTokens: null, outputTokens: null, costMicros: null, durationMs: 1200 },
      },
    });
    let mode: "delay" | "error" | "ok" = "delay";
    await page.route("**/api/designs/ai/generate-image", async (route) => {
      try {
        if (mode === "delay") {
          await new Promise((r) => setTimeout(r, 4000));
          await route.fulfill({ json: result([srcA]) });
        } else if (mode === "error") {
          await route.fulfill({
            status: 502,
            json: {
              ok: false,
              error: "Erro da OpenAI ao gerar a imagem (500).",
              code: "provider_error",
              kind: "unavailable",
              retryable: true,
            },
          });
        } else {
          await route.fulfill({ json: result([srcA, srcB]) });
        }
      } catch {
        // Pedido cancelado pelo navegador (teste de cancelamento).
      }
    });

    let gen = await openGenerator(page);
    await expect(gen.getByTestId("image-generator-model")).toBeVisible({ timeout: 30_000 });
    await gen.getByTestId("image-generator-prompt").fill(PROMPT);

    // 4 + 12. Geração em andamento e cancelamento.
    await gen.getByTestId("image-generator-generate").click();
    await expect(gen.getByTestId("image-generator-running")).toBeVisible();
    await gen.getByRole("button", { name: "Cancelar geração" }).click();
    await expect(gen.getByTestId("image-generator-running")).toBeHidden();
    await expect(toast(page, "Geração cancelada.")).toBeVisible();
    await expect(gen.getByTestId("image-generator-results")).toHaveCount(0);

    // 8. Erro de geração com nova tentativa.
    mode = "error";
    await gen.getByTestId("image-generator-generate").click();
    const error = gen.getByTestId("image-generator-error");
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText("Erro da OpenAI ao gerar a imagem (500).");

    // 5 + 6. Concluída com duas variações; a primeira fica selecionada e ampliada.
    mode = "ok";
    await error.getByRole("button", { name: "Tentar de novo" }).click();
    const results = gen.getByTestId("image-generator-results");
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results).toContainText("2 imagem(ns)");
    await expect(results.getByRole("button", { name: "Variação 1" })).toHaveAttribute("aria-pressed", "true");
    await expect(gen.getByTestId("image-generator-preview")).toBeVisible();

    // 11. Inserir no slide atual (1): elemento novo, proporção original, centralizado e selecionado.
    await gen.getByTestId("image-generator-insert").click();
    await expect.poll(async () => (await images(page, 0)).length, { timeout: 30_000 }).toBe(1);
    const inserted = (await images(page, 0))[0]!;
    expect(inserted).toMatchObject({ src: srcA, naturalWidth: 480, naturalHeight: 320, width: 480, height: 320 });
    expect([inserted.x, inserted.y]).toEqual([300, 380]);
    expect(inserted.name.startsWith("IA:")).toBe(true);
    await expect.poll(() => selection(page)).toEqual([inserted.id]);
    await expect(toast(page, "Imagem inserida no slide 1.")).toBeVisible();

    // Trocar de slide: a inserção vai sempre para o slide ativo no momento (nunca para o anterior).
    await activatePage(page, "Página 2");
    gen = await openGenerator(page);
    await expect(gen.getByTestId("image-generator-where")).toHaveText("Slide 2 de 2");
    // Os resultados continuam depois de fechar/abrir o painel.
    await expect(gen.getByTestId("image-generator-results")).toBeVisible();
    await gen.getByRole("button", { name: "Variação 2" }).click();
    await gen.getByTestId("image-generator-insert-background").click();
    await expect.poll(async () => (await images(page, 1)).length, { timeout: 30_000 }).toBe(1);
    expect((await images(page, 0)).length).toBe(1);
    const bg = (await objects(page, 1))[0]!;
    expect(bg).toMatchObject({ type: "image", src: srcB, x: 0, y: 0, width: 1080, height: 1080 });
    expect(bg.crop).toBeTruthy();
    await expect(toast(page, "Imagem aplicada como fundo no slide 2.")).toBeVisible();

    // Substituir a imagem selecionada (o fundo recém-inserido) pela variação 1: a caixa não muda.
    await expect.poll(() => selection(page)).toEqual([bg.id]);
    gen = await openGenerator(page);
    await gen.getByRole("button", { name: "Variação 1" }).click();
    await expect(gen.getByTestId("image-generator-insert-replace")).toBeEnabled();
    await gen.getByTestId("image-generator-insert-replace").click();
    await expect.poll(async () => (await objects(page, 1))[0]!.src).toBe(srcA);
    expect((await objects(page, 1))[0]).toMatchObject({ id: bg.id, width: 1080, height: 1080 });
    await expect(toast(page, "Imagem substituída no slide 2.")).toBeVisible();

    // 12. Descartar os resultados (as imagens continuam em Arquivos e na arte).
    gen = await openGenerator(page);
    await gen.getByRole("button", { name: "Descartar resultados" }).click();
    await expect(gen.getByTestId("image-generator-results")).toHaveCount(0);
    await expect(gen.getByTestId("image-generator-picked")).toHaveCount(0);
    await closeSheet(page);

    // 14. Salvo no servidor; reabrir mantém as imagens inseridas, editáveis como qualquer outra.
    await waitServerSave(page);
    await page.reload();
    await editorReady(page);
    expect((await images(page, 0)).map((o) => [o.src, o.width, o.height])).toEqual([[srcA, 480, 320]]);
    expect((await objects(page, 1))[0]).toMatchObject({
      id: bg.id,
      type: "image",
      src: srcA,
      width: 1080,
      height: 1080,
    });
    await expectNoHorizontalScroll(page);
  });
});

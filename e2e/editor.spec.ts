import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Client } from "pg";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Editor profissional (Estúdio): formatos, texto, formas, imagens da
 * biblioteca, propriedades, camadas, páginas e carrossel, desfazer/refazer,
 * salvamento automático, exportação para Arquivos e abertura de artes do
 * formato antigo. Roda no computador e no celular (projetos do Playwright).
 *
 * O estado do documento é conferido também por `window.__designEditor`
 * (exposto fora de produção) — a interface continua sendo o caminho das ações.
 * O teste da arte antiga grava o documento direto no banco (E2E_ENV_FILE
 * aponta o .env com DATABASE_OWNER_URL; padrão: .env).
 */

const ORG = `/w/${DEMO.org}`;
const SAVED = "Todas as alterações salvas";
const IMAGE = path.join(__dirname, "fixtures", "foto-editor.png");

type Obj = { id: string; type: string; name: string; x: number; y: number; width: number; height: number } & Record<
  string,
  unknown
>;
type Doc = {
  schema: string;
  pages: { id: string; name: string; width: number; height: number; objects: Obj[] }[];
  meta?: Record<string, unknown>;
};

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

async function editorReady(page: Page) {
  await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
}

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
  return page.url();
}

const doc = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { doc: unknown } } }).__designEditor.store.doc,
  ) as Promise<Doc>;
const objects = async (page: Page, pageIndex = 0) => (await doc(page)).pages[pageIndex]!.objects;
const selection = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { selection: string[] } } }).__designEditor.store.selection,
  );

const indicator = (page: Page) => page.locator("[data-save-state]").first();
async function waitServerSave(page: Page, after = "") {
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 });
  await expect
    .poll(async () => (await indicator(page).getAttribute("data-saved-at")) ?? "", { timeout: 30_000 })
    .not.toBe(after);
  return (await indicator(page).getAttribute("data-saved-at")) ?? "";
}

type PanelName = "Adicionar" | "Camadas" | "Marca" | "Imagens" | "Componentes" | "Modelos" | "Editar";

/** Abre um painel: barra lateral no computador, gaveta no celular. */
async function panel(page: Page, name: PanelName): Promise<Locator> {
  if (isMobile(page)) {
    await closePanel(page);
    const nav = page.getByRole("navigation", { name: "Ferramentas" });
    const direct: Partial<Record<PanelName, string>> = {
      Adicionar: "Adicionar",
      Camadas: "Camadas",
      Marca: "Marca",
      Editar: "Editar",
      Imagens: "Imagem",
    };
    if (direct[name]) await nav.getByRole("button", { name: direct[name]!, exact: true }).click();
    else {
      await nav.getByRole("button", { name: "Adicionar", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
    }
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    return dlg;
  }
  if (name === "Editar") return page.getByTestId("properties-panel");
  await page.getByRole("navigation", { name: "Painéis do editor" }).getByRole("button", { name, exact: true }).click();
  return page.getByTestId("editor-left-panel");
}

async function closePanel(page: Page) {
  if (!isMobile(page)) return;
  const dlg = page.getByRole("dialog");
  if (await dlg.isVisible().catch(() => false)) {
    await dlg.getByRole("button", { name: "Fechar" }).click();
    await expect(dlg).toBeHidden();
  }
}

/** Seleciona uma camada pelo painel de camadas. */
async function selectLayer(page: Page, id: string) {
  const p = await panel(page, "Camadas");
  await p.locator(`[data-layer-id="${id}"] button[aria-pressed]`).first().click();
  await expect.poll(() => selection(page)).toEqual([id]);
  await closePanel(page);
}

/** Centro de um objeto na tela (para clicar/editar direto no canvas). */
function screenPoint(page: Page, id: string) {
  return page.evaluate((objId) => {
    const ed = (
      window as unknown as {
        __designEditor: {
          scene: {
            fabricObjectOf: (id: string) => { getCenterPoint(): { x: number; y: number } } | null;
            viewport(): { zoom: number; x: number; y: number };
            canvas: { upperCanvasEl: HTMLCanvasElement };
          };
        };
      }
    ).__designEditor;
    const obj = ed.scene.fabricObjectOf(objId)!;
    const c = obj.getCenterPoint();
    const v = ed.scene.viewport();
    const r = ed.scene.canvas.upperCanvasEl.getBoundingClientRect();
    return { x: r.left + c.x * v.zoom + v.x, y: r.top + c.y * v.zoom + v.y };
  }, id);
}

/** "Enviar para Arquivos" do cabeçalho (no celular o rótulo é só "Enviar"). */
const sendButton = (page: Page) => page.locator("header").getByRole("button", { name: /^Enviar/ });

async function fillAndCommit(field: Locator, value: string) {
  await field.click();
  await field.fill(value);
  await field.press("Enter");
}

test.describe("editor profissional", () => {
  test("formato, texto, forma, imagens da biblioteca, propriedades, camadas, desfazer e reabrir editável", async ({
    page,
  }) => {
    await enter(page);
    await newDesign(page, `Editor ${Date.now().toString(36)}`, "ig-portrait");
    const d = await doc(page);
    expect(d.schema).toBe("aragonez.design/2");
    expect(d.pages[0]).toMatchObject({ width: 1080, height: 1350 });
    // Sem seleção, o painel mostra a página (formato escolhido).
    let props = await panel(page, "Editar");
    await expect(props.getByLabel("Largura", { exact: true })).toHaveValue("1080");
    await expect(props.getByLabel("Altura", { exact: true })).toHaveValue("1350");

    // Texto e forma.
    let add = await panel(page, "Adicionar");
    await add.getByRole("button", { name: "Adicionar título" }).click();
    add = await panel(page, "Adicionar");
    await add.getByRole("button", { name: "Adicionar retângulo" }).click();
    await closePanel(page);
    let objs = await objects(page);
    expect(objs.map((o) => o.type)).toEqual(["text", "rect"]);
    const [title, rect] = objs as [Obj, Obj];
    // Centralizados na página (não no meio da tela).
    expect(Math.round(title.x + title.width / 2)).toBe(540);

    // Propriedades reais: cor do retângulo e tamanho da fonte do título.
    props = await panel(page, "Editar");
    await fillAndCommit(props.getByLabel("Preenchimento: código da cor"), "#2563eb");
    await expect.poll(async () => (await objects(page))[1]!.fill).toBe("#2563eb");
    await closePanel(page);
    await selectLayer(page, title.id);
    props = await panel(page, "Editar");
    await fillAndCommit(props.getByLabel("Tamanho", { exact: true }), "120");
    await expect.poll(async () => (await objects(page))[0]!.fontSize).toBe(120);
    await props.getByRole("button", { name: "Itálico" }).click();
    await expect.poll(async () => (await objects(page))[0]!.fontStyle).toBe("italic");
    await closePanel(page);

    // Imagem enviada para Arquivos e depois inserida pela biblioteca.
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(IMAGE);
    await expect
      .poll(async () => (await objects(page)).filter((o) => o.type === "image").length, { timeout: 30_000 })
      .toBe(1);
    const uploaded = (await objects(page)).find((o) => o.type === "image")!;
    expect(String(uploaded.src)).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
    expect(uploaded).toMatchObject({ naturalWidth: 480, naturalHeight: 320 });
    await page.keyboard.press("Escape");
    await expect.poll(() => selection(page)).toEqual([]);
    const media = await panel(page, "Imagens");
    await media
      .getByRole("button", { name: /Inserir imagem foto-editor/ })
      .first()
      .click();
    await expect
      .poll(async () => (await objects(page)).filter((o) => o.type === "image").length, { timeout: 30_000 })
      .toBe(2);
    await closePanel(page);

    // Camadas: ocultar, bloquear e ordem.
    let layers = await panel(page, "Camadas");
    await layers.locator(`[data-layer-id="${rect.id}"]`).getByRole("button", { name: "Ocultar" }).click();
    await expect.poll(async () => (await objects(page)).find((o) => o.id === rect.id)!.hidden).toBe(true);
    await layers.locator(`[data-layer-id="${title.id}"]`).getByRole("button", { name: "Bloquear" }).click();
    await expect.poll(async () => (await objects(page)).find((o) => o.id === title.id)!.locked).toBe(true);
    await layers.locator(`[data-layer-id="${rect.id}"]`).getByRole("button", { name: "Mostrar" }).click();
    await closePanel(page);
    await selectLayer(page, rect.id);
    props = await panel(page, "Editar");
    await props.getByRole("button", { name: "Trazer para o topo" }).click();
    await expect.poll(async () => (await objects(page)).at(-1)!.id).toBe(rect.id);
    await closePanel(page);
    layers = await panel(page, "Camadas");
    // A lista mostra do topo para o fundo.
    await expect(layers.locator("[data-testid=layers-list] > li").first()).toContainText("Retângulo");
    await closePanel(page);

    // Desfazer e refazer.
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect.poll(async () => (await objects(page)).at(-1)!.id).not.toBe(rect.id);
    await page.getByRole("button", { name: "Refazer" }).click();
    await expect.poll(async () => (await objects(page)).at(-1)!.id).toBe(rect.id);

    // Salvo no servidor; reabre com tudo editável.
    await waitServerSave(page);
    await expect(indicator(page)).toContainText(SAVED);
    const before = await objects(page);
    await page.reload();
    await editorReady(page);
    objs = await objects(page);
    expect(objs.map((o) => [o.id, o.type])).toEqual(before.map((o) => [o.id, o.type]));
    expect(objs.find((o) => o.id === title.id)).toMatchObject({ fontSize: 120, fontStyle: "italic", locked: true });

    // Desbloqueia e edita o texto direto no canvas.
    layers = await panel(page, "Camadas");
    await layers.locator(`[data-layer-id="${title.id}"]`).getByRole("button", { name: "Desbloquear" }).click();
    await closePanel(page);
    // Traz o título para a frente (imagens e retângulo estão por cima) e edita com duplo clique.
    await selectLayer(page, title.id);
    props = await panel(page, "Editar");
    await props.getByRole("button", { name: "Trazer para o topo" }).click();
    await expect.poll(async () => (await objects(page)).at(-1)!.id).toBe(title.id);
    await closePanel(page);
    const p = await screenPoint(page, title.id);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Oferta de verão");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await objects(page)).find((o) => o.id === title.id)!.text).toBe("Oferta de verão");
    await waitServerSave(page);
    await expectNoHorizontalScroll(page);
  });

  test("várias páginas e carrossel: reordenar slides, desfazer e exportar todas para Arquivos", async ({ page }) => {
    await enter(page);
    await newDesign(page, `Carrossel ${Date.now().toString(36)}`, "carousel-square", 3);
    let d = await doc(page);
    expect(d.meta?.carousel).toBe(true);
    expect(d.pages.map((p) => [p.name, p.width, p.height])).toEqual([
      ["Página 1", 1080, 1080],
      ["Página 2", 1080, 1080],
      ["Página 3", 1080, 1080],
    ]);
    const add = await panel(page, "Adicionar");
    await add.getByRole("button", { name: "Adicionar título" }).click();
    await closePanel(page);
    expect((await objects(page, 0)).length).toBe(1);

    let pagesPanel = await panel(page, "Camadas");
    const list = pagesPanel.getByTestId("pages-list");
    await expect(list.locator(":scope > li")).toHaveCount(3);
    await pagesPanel.getByRole("button", { name: "Mover Página 1 para baixo" }).click();
    await expect
      .poll(async () => (await doc(page)).pages.map((p) => p.name))
      .toEqual(["Página 2", "Página 1", "Página 3"]);
    await expect(list.locator(":scope > li").nth(1)).toContainText("Página 1");
    await closePanel(page);
    await page.getByRole("button", { name: "Desfazer" }).click();
    await expect
      .poll(async () => (await doc(page)).pages.map((p) => p.name))
      .toEqual(["Página 1", "Página 2", "Página 3"]);
    await page.getByRole("button", { name: "Refazer" }).click();
    await expect
      .poll(async () => (await doc(page)).pages.map((p) => p.name))
      .toEqual(["Página 2", "Página 1", "Página 3"]);
    // O título continua na página dele (agora o 2º slide).
    expect((await objects(page, 1)).map((o) => o.name)).toEqual(["Título"]);

    pagesPanel = await panel(page, "Camadas");
    await pagesPanel.getByRole("button", { name: "Adicionar página" }).click();
    await expect.poll(async () => (await doc(page)).pages.length).toBe(4);
    pagesPanel = await panel(page, "Camadas");
    await pagesPanel.getByRole("button", { name: "Duplicar Página 1" }).click();
    await expect.poll(async () => (await doc(page)).pages.length).toBe(5);
    pagesPanel = await panel(page, "Camadas");
    await pagesPanel.getByRole("button", { name: "Excluir Página 1 (cópia)" }).click();
    await expect.poll(async () => (await doc(page)).pages.length).toBe(4);
    await closePanel(page);
    d = await doc(page);
    // Carrossel: todas as páginas do mesmo tamanho.
    expect(new Set(d.pages.map((p) => `${p.width}x${p.height}`)).size).toBe(1);

    await waitServerSave(page);
    const sent = page.locator("[data-sonner-toast]").filter({ hasText: "4 arquivos enviados para Arquivos" });
    await sendButton(page).click();
    await expect(sent).toBeVisible({ timeout: 60_000 });
    const outputs = (await doc(page)).meta?.outputs as Record<string, string>;
    expect(Object.keys(outputs)).toHaveLength(4);
    await expect(sent).toBeHidden({ timeout: 30_000 });
    // Exportar de novo: novas versões dos mesmos arquivos.
    await sendButton(page).click();
    await expect(sent).toBeVisible({ timeout: 60_000 });
    expect((await doc(page)).meta?.outputs).toEqual(outputs);
    await waitServerSave(page);
    const names = (await doc(page)).pages.map((p) => p.name);
    // A página nova entra depois da página ativa.
    expect(names).toEqual(["Página 2", "Página 1", "Página 4", "Página 3"]);
    await page.reload();
    await editorReady(page);
    expect((await doc(page)).pages.map((p) => p.name)).toEqual(names);
    await expectNoHorizontalScroll(page);
  });

  test("exportar: PNG para Arquivos (nova versão a cada envio) e download de PNG e PDF", async ({ page }) => {
    await enter(page);
    await newDesign(page, `Exportar ${Date.now().toString(36)}`, "ig-square");
    const add = await panel(page, "Adicionar");
    await add.getByRole("button", { name: "Adicionar título" }).click();
    await closePanel(page);
    await waitServerSave(page);

    await sendButton(page).click();
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Arte enviada para Arquivos" });
    await expect(toast).toBeVisible({ timeout: 60_000 });
    await expect(toast).toBeHidden({ timeout: 30_000 });
    await sendButton(page).click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: "Nova versão enviada para Arquivos" }),
    ).toBeVisible({ timeout: 60_000 });

    // Download pelo diálogo de exportação.
    const openExport = async () => {
      if (isMobile(page)) {
        await page.getByRole("button", { name: "Mais ações" }).click();
        await page.getByRole("menuitem", { name: /Exportar/ }).click();
      } else await page.getByRole("button", { name: "Exportar", exact: true }).click();
      return page.getByRole("dialog", { name: "Exportar arte" });
    };
    let dialog = await openExport();
    const png = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Baixar" }).click();
    expect((await png).suggestedFilename()).toMatch(/\.png$/);
    dialog = await openExport();
    await dialog.getByRole("button", { name: /^PDF/ }).click();
    const pdf = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Baixar" }).click();
    const file = await pdf;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await (await file.createReadStream()).toArray();
    expect(Buffer.concat(bytes).subarray(0, 8).toString()).toBe("%PDF-1.4");

    // O arquivo exportado está em Arquivos (atalho "Abrir" do aviso).
    await sendButton(page).click();
    await page
      .locator("[data-sonner-toast]")
      .filter({ hasText: "Nova versão" })
      .last()
      .getByRole("button", { name: "Abrir" })
      .click();
    await page.waitForURL(/\/files\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByText(/Exportar .*\.png/).first()).toBeVisible();
  });

  test("arte do formato antigo abre editável e o original fica no histórico", async ({ page }) => {
    await enter(page);
    const url = await newDesign(page, `Antiga ${Date.now().toString(36)}`, "ig-square");
    const id = url.split("/").at(-1)!;
    // Documento como o editor antigo (Fabric, página única) salvava.
    const legacy = {
      version: "7.4.0",
      background: "#ffffff",
      objects: [
        {
          type: "Textbox",
          version: "7.4.0",
          uid: "lgcytitl",
          name: "Título",
          text: "Arte antiga",
          left: 398,
          top: 398,
          width: 810,
          height: 103.96,
          fontSize: 92,
          fontFamily: "Inter",
          fontWeight: 700,
          fill: "#121110",
          textAlign: "center",
          lineHeight: 1.15,
          originX: "center",
          originY: "center",
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          strokeWidth: 1,
          stroke: null,
          charSpacing: 0,
          styles: [],
        },
        {
          type: "Circle",
          version: "7.4.0",
          uid: "lgcycirc",
          name: "Círculo",
          left: 700,
          top: 700,
          width: 324,
          height: 324,
          radius: 162,
          fill: "#F4BF2F",
          originX: "center",
          originY: "center",
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          strokeWidth: 1,
          stroke: null,
        },
      ],
    };
    const env = config({ path: process.env.E2E_ENV_FILE ?? ".env", processEnv: {}, quiet: true }).parsed ?? {};
    const db = new Client({ connectionString: env.DATABASE_OWNER_URL || env.DATABASE_URL });
    await db.connect();
    try {
      await db.query("set app.rls_bypass = on");
      await db.query("update designs set document = $1, revision = revision + 1 where id = $2", [legacy, id]);
    } finally {
      await db.end();
    }

    await page.reload();
    await editorReady(page);
    const objs = await objects(page);
    expect(objs.map((o) => [o.id, o.type, o.name])).toEqual([
      ["lgcytitl", "text", "Título"],
      ["lgcycirc", "ellipse", "Círculo"],
    ]);
    // Mesma posição do editor antigo (centro em 398,398).
    expect(objs[0]!.x + objs[0]!.width / 2).toBeCloseTo(398, 0);
    const layers = await panel(page, "Camadas");
    await expect(layers.getByText("Círculo", { exact: true })).toBeVisible();
    await closePanel(page);

    await selectLayer(page, "lgcycirc");
    const props = await panel(page, "Editar");
    await fillAndCommit(props.getByLabel("Preenchimento: código da cor"), "#16a34a");
    await closePanel(page);
    await waitServerSave(page);
    expect((await doc(page)).schema).toBe("aragonez.design/2");

    await page.getByRole("button", { name: "Histórico de versões" }).click();
    await expect(
      page.getByTestId("design-versions").getByText("Formato anterior (antes do novo editor)"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await editorReady(page);
    expect((await objects(page)).find((o) => o.id === "lgcycirc")!.fill).toBe("#16a34a");
  });
});

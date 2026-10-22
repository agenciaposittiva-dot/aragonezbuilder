import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Gerador automático de carrosséis (Estúdio) com o provedor de demonstração:
 * três temas de segmentos diferentes (rápido e completo), progresso real,
 * abertura no editor, texto dentro da área segura medido pelo próprio editor,
 * carrosséis diferentes entre si, edição de texto, regenerar um slide, nova
 * direção visual, persistência depois de recarregar, exportação no tamanho
 * exato, segunda versão e importação de JPG/PNG como modelo.
 * Pré-requisito: e2e/seed-trends.ts (ativa o provedor de demonstração).
 */

const ORG = `/w/${DEMO.org}`;
const IMAGE = path.join(__dirname, "fixtures", "foto-editor.png");

type Obj = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};
type Meta = {
  input: { objective: string; format: string };
  direction: { key: string; motif: string };
  slides: { key: string; pageId: string; role: string; layout: string; title: string }[];
  variantOf: string | null;
};
type Doc = {
  pages: { id: string; width: number; height: number; objects: Obj[] }[];
  meta: { carousel?: boolean; generator?: Meta };
};

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 1024;

async function enter(page: Page) {
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

const editorReady = (page: Page) => expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 90_000 });
const doc = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __designEditor: { store: { doc: unknown } } }).__designEditor.store.doc,
  ) as Promise<Doc>;
const indicator = (page: Page) => page.locator("[data-save-state]").first();
/** Página sem a altura medida dos textos (o editor mede de novo quando as fontes carregam). */
const pageKey = (p: Doc["pages"][number]) =>
  JSON.stringify(p, (k, v: unknown) => (k === "height" && typeof v === "number" && !Number.isInteger(v) ? 0 : v));

async function generate(
  page: Page,
  topic: string,
  full?: { objective: string; slides: string; format: "portrait" | "square" },
) {
  await page.goto(`${ORG}/studio/gerar`);
  await page.getByLabel("Assunto do carrossel").fill(topic);
  if (full) {
    await page.getByRole("radio", { name: "Completo" }).click();
    await page.getByLabel("Objetivo").fill(full.objective);
    await page.getByLabel("Quantidade de slides").selectOption(full.slides);
    await page.getByLabel("Formato").selectOption(full.format);
  }
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Gerar carrossel" }).click();
  // Progresso real vindo do servidor (etapa de planejamento em andamento ou concluída).
  await expect(page.locator('[data-testid=carousel-progress] [data-step="plan"]')).toBeVisible({ timeout: 30_000 });
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}\?gerado=1$/, { timeout: 120_000 });
  await editorReady(page);
  return page.url().match(/studio\/([0-9a-f-]{36})/)![1]!;
}

/** Medidas reais do editor (Fabric): texto dentro da página e título sem invadir o texto abaixo. */
async function measured(page: Page) {
  return page.evaluate(() => {
    const ed = (
      window as unknown as {
        __designEditor: {
          store: { doc: Doc };
          scene: { fabricObjectOf(id: string): { getScaledHeight(): number } | null };
        };
      }
    ).__designEditor;
    const problems: string[] = [];
    for (const p of ed.store.doc.pages) {
      const texts = p.objects.filter((o) => o.type === "text" && !o.name.startsWith("Decorativo"));
      const h = (o: Obj) => ed.scene.fabricObjectOf(o.id)?.getScaledHeight() ?? o.height;
      for (const t of texts) if (t.y + h(t) > p.height - 24) problems.push(`${t.id} passa do rodapé`);
      const title = texts.find((t) => t.id.endsWith("-title"));
      const below = texts.filter((t) => title && t !== title && t.y > title.y && Math.abs(t.x - title.x) < 40);
      for (const b of below) if (title && title.y + h(title) > b.y + 4) problems.push(`${title.id} encosta em ${b.id}`);
    }
    return problems;
  });
}

async function moreActions(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.describe("gerador automático de carrosséis", () => {
  test("três temas (rápido e completo): progresso real, editor aberto, carrosséis diferentes e texto dentro da área", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await enter(page);
    await page.goto(`${ORG}/studio`);
    await expect(page.getByRole("link", { name: "Gerar carrossel com IA" })).toBeVisible();
    const themes: [string, Parameters<typeof generate>[2]?][] = [
      ["Clareamento dental: mitos e cuidados"],
      [
        "Como montar uma reserva de emergência",
        { objective: "Gerar salvamentos e compartilhamentos", slides: "6", format: "square" },
      ],
      ["Café especial em casa"],
    ];
    const signatures = new Set<string>();
    for (const [topic, full] of themes) {
      await generate(page, topic, full);
      const d = await doc(page);
      const meta = d.meta.generator!;
      expect(d.meta.carousel).toBe(true);
      expect(meta.slides.map((s) => s.pageId)).toEqual(d.pages.map((p) => p.id));
      expect(meta.slides[0]!.role).toBe("cover");
      if (full) {
        expect(d.pages).toHaveLength(6);
        expect(d.pages[0]).toMatchObject({ width: 1080, height: 1080 });
        expect(meta.input.objective).toBe(full.objective);
      } else {
        expect(d.pages.length).toBeGreaterThanOrEqual(5);
        expect(d.pages[0]).toMatchObject({ width: 1080, height: 1350 });
      }
      await expect.poll(() => measured(page), { timeout: 20_000 }).toEqual([]);
      signatures.add(JSON.stringify([meta.direction.key, meta.direction.motif, meta.slides.map((s) => s.layout)]));
      // Salvo na nuvem antes de abrir (o editor não tem nada pendente).
      await expect(indicator(page)).toHaveAttribute("data-save-state", "saved");
    }
    expect(signatures.size).toBe(3);
  });

  test("editar texto, regenerar um slide, nova direção visual, recarregar, exportar e segunda versão", async ({
    page,
  }) => {
    test.setTimeout(420_000);
    await enter(page);
    const id = await generate(page, "Treino de força para iniciantes");
    let d = await doc(page);
    const meta = d.meta.generator!;
    const slide2 = meta.slides[1]!;

    // Edição direta no canvas (duplo clique no título do slide 2).
    await page.evaluate((pageId) => {
      (
        window as unknown as { __designEditor: { store: { setActivePage(id: string): void } } }
      ).__designEditor.store.setActivePage(pageId);
    }, slide2.pageId);
    const pt = await page.evaluate((objId) => {
      const ed = (
        window as unknown as {
          __designEditor: {
            scene: {
              fabricObjectOf(id: string): { getCenterPoint(): { x: number; y: number } } | null;
              viewport(): { zoom: number; x: number; y: number };
              canvas: { upperCanvasEl: HTMLCanvasElement };
            };
          };
        }
      ).__designEditor;
      const c = ed.scene.fabricObjectOf(objId)!.getCenterPoint();
      const v = ed.scene.viewport();
      const r = ed.scene.canvas.upperCanvasEl.getBoundingClientRect();
      return { x: r.left + c.x * v.zoom + v.x, y: r.top + c.y * v.zoom + v.y };
    }, `${slide2.key}-title`);
    await page.mouse.dblclick(pt.x, pt.y);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Comece com o básico bem feito");
    await page.keyboard.press("Escape");
    const titleOf = async (pageIndex: number, key: string) =>
      ((await doc(page)).pages[pageIndex]!.objects.find((o) => o.id === `${key}-title`)?.text ?? "").toLowerCase();
    await expect.poll(() => titleOf(1, slide2.key)).toBe("comece com o básico bem feito");
    await expect(indicator(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 });

    // Regenerar só o slide 3.
    d = await doc(page);
    const before = d.pages.map(pageKey);
    await page.evaluate((pageId) => {
      (
        window as unknown as { __designEditor: { store: { setActivePage(id: string): void } } }
      ).__designEditor.store.setActivePage(pageId);
    }, meta.slides[2]!.pageId);
    await moreActions(page, "Regenerar este slide…");
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Pedido de ajuste (opcional)").fill("mais direto");
    await dlg.getByRole("button", { name: "Regenerar slide" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Slide 3 regenerado" })).toBeVisible({
      timeout: 60_000,
    });
    d = await doc(page);
    expect(pageKey(d.pages[2]!)).not.toBe(before[2]);
    d.pages.forEach((p, i) => i !== 2 && expect(pageKey(p)).toBe(before[i]));

    // Nova direção visual: outro estilo, textos (inclusive o editado) mantidos.
    await moreActions(page, "Nova direção visual…");
    await page.getByRole("dialog").getByRole("button", { name: "Trocar direção" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Nova direção visual" })).toBeVisible({
      timeout: 60_000,
    });
    d = await doc(page);
    expect(d.meta.generator!.direction.key).not.toBe(meta.direction.key);
    expect(await titleOf(1, slide2.key)).toBe("comece com o básico bem feito");
    await expect.poll(() => measured(page), { timeout: 20_000 }).toEqual([]);

    // Persistência: recarregar traz exatamente o mesmo documento.
    await expect(indicator(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 });
    const snapshot = (await doc(page)).pages.map(pageKey);
    await page.reload();
    await editorReady(page);
    expect((await doc(page)).pages.map(pageKey)).toEqual(snapshot);

    // Exportação: cada slide no tamanho exato e envio do conjunto para Arquivos.
    const sizes = await page.evaluate(() => {
      const ed = (
        window as unknown as {
          __designEditor: { store: { doc: Doc }; scene: { renderPage(id: string, scale: number): HTMLCanvasElement } };
        }
      ).__designEditor;
      return ed.store.doc.pages.map((p) => {
        const c = ed.scene.renderPage(p.id, 1);
        return `${c.width}x${c.height}`;
      });
    });
    expect(new Set(sizes)).toEqual(new Set(["1080x1350"]));
    const count = (await doc(page)).pages.length;
    await page
      .locator("header")
      .getByRole("button", { name: /^Enviar/ })
      .click();
    await expect(
      page.locator("[data-sonner-toast]").filter({ hasText: `${count} arquivos enviados para Arquivos` }),
    ).toBeVisible({
      timeout: 90_000,
    });

    // Segunda versão: arte nova com outra composição.
    await moreActions(page, "Gerar segunda versão…");
    await page.getByRole("dialog").getByRole("button", { name: "Criar segunda versão" }).click();
    await page.waitForURL((u) => /\/studio\/[0-9a-f-]{36}$/.test(u.pathname) && !u.pathname.endsWith(id), {
      timeout: 60_000,
    });
    await editorReady(page);
    expect((await doc(page)).meta.generator!.variantOf).toBe(id);
    if (!isMobile(page)) await expectNoHorizontalScroll(page);
  });

  test("chat de edição com IA: 'Reescreva o slide 3' e 'Mude só a direção visual' com prévia, aplicar e desfazer", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await enter(page);
    await generate(page, "Rotina de skincare para iniciantes");
    const before = await doc(page);
    if (isMobile(page))
      await page.getByRole("navigation", { name: "Ferramentas" }).getByTestId("mobile-design-ai").click();
    else await page.getByTestId("open-design-ai").click();
    const chat = page.getByTestId("design-ai-chat");
    await expect(chat).toBeVisible();
    // Sugestões próprias do carrossel gerado.
    await expect(chat.getByRole("button", { name: "Reescreva o slide 3" })).toBeVisible();

    const ask = async (message: string) => {
      const input = chat.getByTestId("design-ai-input");
      await input.fill(message);
      await input.press("Enter");
      await expect(chat.getByTestId("design-ai-running")).toBeHidden({ timeout: 60_000 });
      const proposal = chat.getByTestId("design-ai-proposal").last();
      await expect(proposal.getByTestId("design-ai-carousel")).toBeVisible();
      return proposal;
    };

    const p1 = await ask("Reescreva o slide 3");
    await expect(p1.getByTestId("design-ai-carousel")).toContainText("Regenerar o slide 3");
    await p1.getByTestId("design-ai-carousel-run").click();
    await expect(p1.getByTestId("design-ai-carousel-result")).toBeVisible({ timeout: 60_000 });
    // Nada muda até aplicar.
    expect(JSON.stringify((await doc(page)).pages[2])).toBe(JSON.stringify(before.pages[2]));
    await p1.getByTestId("design-ai-apply").click();
    await expect(p1.getByTestId("design-ai-status")).toHaveText("Salvo", { timeout: 60_000 });
    const after = await doc(page);
    expect(pageKey(after.pages[2]!)).not.toBe(pageKey(before.pages[2]!));
    expect(pageKey(after.pages[0]!)).toBe(pageKey(before.pages[0]!));

    const p2 = await ask("Mude só a direção visual");
    await p2.getByTestId("design-ai-carousel-run").click();
    await expect(p2.getByTestId("design-ai-carousel-result")).toContainText("Direção:", { timeout: 60_000 });
    await p2.getByTestId("design-ai-apply").click();
    await expect(p2.getByTestId("design-ai-status")).toHaveText("Salvo", { timeout: 60_000 });
    expect((await doc(page)).meta.generator!.direction.key).not.toBe(before.meta.generator!.direction.key);
    // Desfazer pelo chat volta a direção anterior.
    await p2.getByTestId("design-ai-undo").click();
    await expect
      .poll(async () => (await doc(page)).meta.generator!.direction.key)
      .toBe(after.meta.generator!.direction.key);
  });

  test("importar JPG/PNG como modelo: original em Arquivos como camada de fundo bloqueada", async ({ page }) => {
    test.setTimeout(240_000);
    await enter(page);
    await page.goto(`${ORG}/studio?tab=templates`);
    await page.getByRole("button", { name: "Importar JPG/PNG" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Imagem (JPG, PNG ou WebP)").setInputFiles(IMAGE);
    // A imagem é conferida no navegador antes de liberar o envio.
    await expect(dlg.getByTestId("import-note")).toBeVisible();
    await dlg.getByLabel("Nome").fill(`Modelo importado ${Date.now().toString(36)}`);
    await dlg.getByRole("checkbox", { name: "Reconstruir camadas editáveis com IA" }).click();
    await dlg.getByRole("button", { name: "Importar", exact: true }).click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await editorReady(page);
    // Demonstração não lê imagens: a resposta diz que só a camada de fundo foi criada.
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "só a camada de fundo" })).toBeVisible();
    const d = await doc(page);
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0]!.objects[0]).toMatchObject({ type: "image", locked: true, x: 0, y: 0 });
    expect(d.pages[0]!.objects[0]!.width).toBe(d.pages[0]!.width);
  });
});

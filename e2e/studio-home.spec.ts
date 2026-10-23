import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Estúdio Criador: página inicial (destaque de IA, cartões de formato, galeria
 * de modelos por categoria com prévia e "Usar modelo"), criação rápida que
 * abre o editor no formato certo e, no editor, aparência escura, zoom e a
 * faixa de slides do carrossel (rótulos, duplicar e "+").
 */

const ORG = `/w/${DEMO.org}`;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 1024;

type Doc = { pages: { width: number; height: number }[]; meta?: { carousel?: boolean } };

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

const editorDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __designEditor: { store: { doc: Doc } } }).__designEditor.store.doc);

async function waitEditor(page: Page) {
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? "");

test("início: destaque de IA, cartões, galeria por categoria, prévia e filtros", async ({ page }) => {
  await enter(page);
  await page.goto(`${ORG}/studio`);
  await expect(page.getByRole("heading", { name: "Estúdio Criador", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expect(page.getByTestId("studio-ai-card")).toHaveAttribute("href", `${ORG}/studio/gerar`);
  await expect(page.getByTestId("studio-new-vertical")).toBeVisible();
  await expect(page.getByTestId("studio-new-post")).toBeVisible();

  // Galeria com modelos reais da agência (a semente tem "Minimal escuro" nos templates).
  await expect(page.getByRole("heading", { name: "Comece com um modelo" })).toBeVisible();
  const card = page.getByTestId("template-card").filter({ hasText: "Minimal escuro" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("4:5", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Pré-visualizar Minimal escuro" }).click();
  const preview = page.getByRole("dialog", { name: "Minimal escuro" });
  await expect(preview.getByText("Formato compatível")).toBeVisible();
  await expect(preview.getByText("1080 × 1350 px")).toBeVisible();
  await preview.getByRole("button", { name: "Usar modelo" }).click();
  const create = page.getByRole("dialog", { name: /Nova arte com/ });
  await expect(create).toBeVisible();
  // Modelo já escolhido: não há seletor de formato (as páginas vêm do modelo).
  await expect(create.locator("#d-preset")).toHaveCount(0);
  await create.getByRole("button", { name: "Cancelar" }).click();
  await page.keyboard.press("Escape");

  // Aba Modelos: filtro de categoria mostra só o grupo escolhido.
  await page.goto(`${ORG}/studio?tab=templates&categoria=Minimalista`);
  await expect(page.getByTestId("template-gallery")).toBeVisible();
  const cards = page.getByTestId("template-card");
  expect(await cards.count()).toBeGreaterThan(0);
  for (const c of await cards.all()) await expect(c).toContainText("Minimalista");
  await expectNoHorizontalScroll(page);
});

test("Novo vertical e Novo post abrem o editor no formato certo; carrossel com faixa de slides", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await enter(page);
  await page.goto(`${ORG}/studio`);
  await page.getByTestId("studio-new-vertical").click();
  const vertical = page.getByRole("dialog", { name: "Novo vertical" });
  await expect(vertical.locator("#d-preset")).toHaveValue("story");
  await vertical.locator("#d-name").fill(`Vertical e2e ${stamp}`);
  await vertical.getByRole("button", { name: "Criar e abrir editor" }).click();
  await waitEditor(page);
  let doc = await editorDoc(page);
  expect(doc.pages).toHaveLength(1);
  expect([doc.pages[0]!.width, doc.pages[0]!.height]).toEqual([1080, 1920]);
  // Aparência escura por padrão; volta ao tema do aplicativo ao sair.
  expect(await theme(page)).toBe("dark");
  if (!isMobile(page)) {
    const zoom = page.getByRole("button", { name: "Zoom e visualização" });
    const before = await zoom.innerText();
    await page.getByRole("button", { name: "Aumentar zoom" }).click();
    await expect(zoom).not.toHaveText(before);
  }
  await page.getByRole("link", { name: "Voltar ao Estúdio Criador" }).click();
  await page.waitForURL(/\/studio$/);
  await expect.poll(() => theme(page)).not.toBe("dark");

  await page.getByTestId("studio-new-post").click();
  const post = page.getByRole("dialog", { name: "Novo post" });
  await expect(post.locator("#d-preset")).toHaveValue("ig-portrait");
  await post.getByRole("checkbox", { name: "Carrossel com várias páginas" }).click();
  await expect(post.locator("#d-preset")).toHaveValue("carousel-portrait");
  await post.locator("#d-pages").fill("3");
  await post.locator("#d-name").fill(`Post e2e ${stamp}`);
  await post.getByRole("button", { name: "Criar e abrir editor" }).click();
  await waitEditor(page);
  doc = await editorDoc(page);
  expect(doc.pages).toHaveLength(3);
  expect([doc.pages[0]!.width, doc.pages[0]!.height]).toEqual([1080, 1350]);
  expect(doc.meta?.carousel).toBe(true);
  await expect(page.getByTestId("page-label").first()).toContainText("Slide 1");
  if (!isMobile(page)) {
    // "Ver todas as páginas" deixa a prancheta "+" à vista; ela adiciona um slide no fim.
    await page.getByRole("button", { name: "Zoom e visualização" }).click();
    await page.getByRole("menuitem", { name: "Ver todas as páginas" }).click();
    await page.getByTestId("add-slide").click();
    await expect.poll(async () => (await editorDoc(page)).pages.length).toBe(4);
    await expect(page.getByTestId("page-label").filter({ hasText: "Slide 4" })).toBeVisible();
    await page.getByRole("button", { name: /Duplicar slide 4/ }).click();
    await expect.poll(async () => (await editorDoc(page)).pages.length).toBe(5);
  }
});

import { expect, test } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Biblioteca de modelos: a proprietária (sem ARAGONEZ_ADMIN no ambiente de
 * teste) vê os modelos prontos, adiciona um aos templates da agência e abre no
 * editor com textos e imagens em camadas. Adicionar roda só no computador; o
 * celular confere o mesmo modelo já adicionado. Uma pessoa sem gestão de
 * templates não vê a biblioteca.
 */

const ORG = `/w/${DEMO.org}`;
const RAFAEL = "rafael@demo.aragonez.app";

type EditorDoc = { pages: { objects: { type: string; name: string; text?: string; src?: string }[] }[] };

test.describe("biblioteca de modelos", () => {
  test("adicionar aos templates e abrir no editor com camadas editáveis", async ({ page }, info) => {
    await login(page, DEMO.owner);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    await page.goto(`${ORG}/studio?tab=templates`);
    const library = page.getByRole("region", { name: "Biblioteca de modelos" });
    await expect(library).toBeVisible();
    await expect(library.getByTestId("library-item")).toHaveCount(4);
    await expectNoHorizontalScroll(page);

    const card = library.getByTestId("library-item").filter({ hasText: "Minimal escuro" });
    const add = card.getByRole("button", { name: "Adicionar à agência" });
    if (info.project.name === "desktop" && (await add.count())) {
      await add.click();
      await expect(
        page.locator("[data-sonner-toast]").filter({ hasText: "Modelo adicionado aos templates da agência" }),
      ).toBeVisible({ timeout: 60_000 });
    }
    const open = card.getByRole("link", { name: /Nos templates/ });
    await expect(open).toBeVisible({ timeout: 60_000 });
    await open.click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await page.waitForFunction(() => !!(window as unknown as { __designEditor?: unknown }).__designEditor, null, {
      timeout: 90_000,
    });
    const doc = await page.evaluate(
      () => (window as unknown as { __designEditor: { store: { doc: EditorDoc } } }).__designEditor.store.doc,
    );
    const objects = doc.pages[0]!.objects;
    // Textos como caixas de texto (editáveis) e a foto do perfil como imagem de Arquivos.
    expect(objects.find((o) => o.name === "Título: fino")?.text).toBe("Pessoas não\ncompram");
    expect(objects.filter((o) => o.type === "text").length).toBeGreaterThanOrEqual(10);
    expect(objects.find((o) => o.type === "image")?.src).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
  });

  test("sem gestão de templates, a biblioteca não aparece", async ({ page }) => {
    await login(page, RAFAEL);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
    await page.goto(`${ORG}/studio?tab=templates`);
    await expect(page.getByRole("heading", { name: "Estúdio" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Biblioteca de modelos" })).toHaveCount(0);
  });
});

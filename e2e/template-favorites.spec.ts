import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Favoritos de modelos do Estúdio Criador: a pessoa cria um template a partir
 * de uma arte, favorita na galeria, filtra "Só favoritos" e desfavorita.
 */

const ORG = `/w/${DEMO.org}`;

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

test.describe("favoritos de modelos", () => {
  test("favoritar, filtrar só favoritos e remover", async ({ page }) => {
    await enter(page);
    const name = `Modelo favorito ${Date.now().toString(36)}`;
    // Arte nova → "Salvar como template" (menu Mais ações do editor).
    await page.goto(`${ORG}/studio`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Nova arte" }).first().click();
    await page.fill("#d-name", name);
    await page.selectOption("#d-preset", "ig-square");
    await page.getByRole("button", { name: "Criar e abrir editor" }).click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitem", { name: "Salvar como template" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Template criado" })).toBeVisible({
      timeout: 30_000,
    });

    // Galeria: favoritar.
    await page.goto(`${ORG}/studio?tab=templates&q=${encodeURIComponent(name)}`);
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("template-card").filter({ hasText: name }).first();
    await expect(card).toBeVisible();
    const star = card.getByTestId("template-favorite");
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "adicionado aos favoritos" })).toBeVisible();
    await expect(star).toHaveAttribute("aria-pressed", "true");

    // Filtro "Só favoritos" mostra o modelo; depois de remover, some.
    await page.goto(`${ORG}/studio?tab=templates&favoritos=1`);
    await page.waitForLoadState("networkidle");
    const favored = page.getByTestId("template-card").filter({ hasText: name }).first();
    await expect(favored).toBeVisible();
    await expect(favored.getByTestId("template-favorite")).toHaveAttribute("aria-pressed", "true");
    await favored.getByTestId("template-favorite").click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "removido dos favoritos" })).toBeVisible();
    await expect(page.getByTestId("template-card").filter({ hasText: name })).toHaveCount(0, { timeout: 30_000 });
    await expectNoHorizontalScroll(page);
  });
});

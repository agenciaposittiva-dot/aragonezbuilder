import { expect, test } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/* Página Atualizações: aberta pelo menu, lista os itens testados e filtra por módulo. */

test("atualizações: lista testada e filtro por módulo", async ({ page }) => {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname.startsWith("/w/"), { timeout: 60_000 });
  await page.goto(`/w/${DEMO.org}/updates`);
  await expect(page.getByRole("heading", { name: "Atualizações", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const items = page
    .getByTestId("updates")
    .locator(":scope > li")
    .filter({ has: page.locator("[data-update]") });
  expect(await items.count()).toBeGreaterThan(1);
  await expect(items.first().getByText("Testes executados")).toBeVisible();
  await page.getByRole("combobox", { name: "Todos os módulos" }).selectOption("Rotina");
  await expect(page).toHaveURL(/modulo=Rotina/);
  await expect(page.getByTestId("updates-count")).toHaveText("1 atualização");
  await expect(page.getByRole("heading", { name: "Rotina: tarefas recorrentes" })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * "Me guie": botão no cabeçalho, passos calculados pelo servidor, dicas da
 * tela atual, tour com refazer, "Ir agora" e esconder/mostrar o botão.
 */

const ORG = `/w/${DEMO.org}`;

test("me guie: passos reais, dicas da tela, tour e esconder o botão", async ({ page }) => {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname.startsWith("/w/"), { timeout: 60_000 });
  await page.goto(`${ORG}/demandas`);
  await page.getByTestId("guide-button").click();
  const panel = page.getByRole("dialog", { name: "Me guie" });
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("guide-progress")).toHaveText(/^\d+ de \d+ concluídos$/);
  // A agência de demonstração já tem clientes: o passo aparece concluído.
  await expect(panel.locator('[data-step="client"]')).toHaveAttribute("data-done", "true");
  await expect(panel.getByTestId("guide-screen")).toContainText("Nesta tela: Minhas demandas");

  const tour = panel.getByTestId("guide-tour");
  await expect(tour).toContainText("1 de");
  await tour.getByRole("button", { name: /Próximo/ }).click();
  await expect(tour).toContainText("2 de");
  await tour.getByRole("button", { name: "Refazer o tour" }).click();
  await expect(tour).toContainText("1 de");

  // "Ir agora" de um passo pendente leva à tela e fecha o painel.
  const pending = panel.locator('[data-done="false"]').first();
  if (await pending.count()) {
    const href = await pending.getByRole("link", { name: "Ir agora" }).getAttribute("href");
    await pending.getByRole("link", { name: "Ir agora" }).click();
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(new RegExp(href!.split("?")[0]!.replace(/[/]/g, "\\/")));
    await page.getByTestId("guide-button").click();
  }

  await page.getByRole("dialog", { name: "Me guie" }).getByRole("button", { name: "Esconder o botão" }).click();
  await expect(page.getByTestId("guide-button")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("guide-button")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu do perfil" }).click();
  await page.getByRole("menuitem", { name: /Mostrar o botão/ }).click();
  await expect(page.getByTestId("guide-button")).toBeVisible();
});

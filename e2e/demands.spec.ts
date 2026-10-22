import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Menu lateral com categorias de clientes e "Minhas demandas": criar, mover e
 * excluir categoria (sem perder o cliente), nova demanda pelo modal,
 * indicadores que filtram a lista e "Minha semana" com arrastar para mudar o
 * prazo da própria tarefa. Cada teste usa nomes únicos na agência de demonstração.
 */

const ORG = `/w/${DEMO.org}`;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 1024;

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

/** Resposta da próxima Server Action (gravação no servidor). */
function actionResponse(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
}

async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  await to.scrollIntoViewIfNeeded();
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 20 });
  await page.mouse.up();
}

test.describe("menu lateral e minhas demandas", () => {
  test("categorias de clientes: criar no menu, mover cliente, contador e excluir sem perder o cliente", async ({
    page,
  }) => {
    test.skip(isMobile(page), "No celular o menu é uma gaveta; o fluxo de categorias é o mesmo componente.");
    await enter(page);
    await page.goto(`${ORG}/clients`);
    const tree = page.locator("aside").getByTestId("client-tree");
    await expect(tree).toBeVisible();
    const name = `VIP ${Date.now().toString(36)}`;
    await tree.getByRole("button", { name: "Nova categoria" }).click();
    const save = actionResponse(page);
    await tree.getByRole("textbox", { name: "Nome da categoria" }).fill(name);
    await tree.getByRole("textbox", { name: "Nome da categoria" }).press("Enter");
    await save;
    const folder = tree.getByRole("button", { name: new RegExp(`^${name}\\s*0$`, "i") });
    await expect(folder).toBeVisible();

    // Mover o cliente pela lista: o menu passa a contar 1 e o cliente continua um só.
    const row = page.getByRole("row").filter({ hasText: "Clínica Vitta" });
    const moved = actionResponse(page);
    await row.getByRole("combobox", { name: "Categoria de Clínica Vitta" }).selectOption({ label: name });
    await moved;
    await expect(tree.getByRole("button", { name: new RegExp(`^${name}\\s*1$`, "i") })).toBeVisible();
    await page.getByRole("link", { name: new RegExp(`^${name}\\s*1$`) }).click();
    await expect(page.getByRole("row").filter({ hasText: "Clínica Vitta" })).toHaveCount(1);
    await expectNoHorizontalScroll(page);

    // Excluir a categoria pede confirmação e deixa o cliente "Sem categoria".
    const category = tree.locator("[data-category-id]").filter({ hasText: name });
    await category.hover();
    await category.getByRole("button", { name: `Ações da categoria ${name}` }).click();
    await page.getByRole("menuitem", { name: "Excluir categoria" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Nenhum cliente, projeto ou arquivo é apagado");
    const removed = actionResponse(page);
    await dialog.getByRole("button", { name: "Excluir categoria" }).click();
    await removed;
    await expect(tree.locator("[data-category-id]").filter({ hasText: name })).toHaveCount(0);
    await page.goto(`${ORG}/clients`);
    await expect(
      page.getByRole("row").filter({ hasText: "Clínica Vitta" }).getByRole("combobox"),
    ).toHaveValue("");
  });

  test("nova demanda, indicadores que filtram e minha semana com arrastar para mudar o prazo", async ({ page }) => {
    await enter(page);
    await page.goto(`${ORG}/demandas`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Helena");
    const todayKpi = page.getByTestId("kpi-hoje");
    const before = Number(await todayKpi.locator("p").first().innerText());

    const title = `Carrossel de lançamento ${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "Nova demanda" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Nova demanda" })).toBeVisible();
    await dialog.locator("#t-title").fill(title);
    await dialog.locator("#t-project").selectOption({ index: 1 });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    await dialog.locator("#t-due").fill(today);
    await dialog.getByRole("button", { name: "Criar" }).click();
    await expect(dialog).toBeHidden();
    // Fica na mesma tela, com o indicador atualizado.
    await expect(page).toHaveURL(/\/demandas/);
    await expect(todayKpi.locator("p").first()).toHaveText(String(before + 1));

    // O indicador filtra a lista.
    await todayKpi.click();
    await expect(page).toHaveURL(/filtro=hoje/);
    await expect(page.getByTestId("demands-list")).toContainText(title);
    await expect(todayKpi).toHaveAttribute("aria-current", "true");
    await page.getByTestId("kpi-atrasadas").click();
    await expect(page.getByTestId("demands-list").or(page.getByText("Nada neste indicador"))).not.toContainText(title);

    // Por prazo muda a organização (grupos de prazo em vez de etapas).
    await page.goto(`${ORG}/demandas?ordem=prazo`);
    const list = page.getByTestId("demands-list");
    await expect(list.getByRole("button", { name: /^Hoje \d+$/ })).toBeVisible();
    // Por etapa os grupos são as etapas do fluxo (ex.: "A fazer"), não as faixas de prazo.
    await page.goto(`${ORG}/demandas`);
    await expect(list.getByRole("button", { name: /^A fazer \d+$/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^Hoje \d+$/ })).toHaveCount(0);

    // Minha semana: arrastar para amanhã muda o prazo da própria tarefa.
    await page.goto(`${ORG}/demandas?visao=semana`);
    const week = page.getByTestId("demands-week");
    const todayCol = week.locator(`[data-day="${today}"]`);
    await expect(todayCol).toContainText(title);
    if (!isMobile(page)) {
      const card = todayCol.locator("article").filter({ hasText: title });
      const tomorrowCol = week.locator("section[data-day]").nth(await week.locator("section[data-day]").evaluateAll(
        (els, d) => els.findIndex((e) => e.getAttribute("data-day") === d) + 1,
        today,
      ));
      const saved = actionResponse(page);
      await drag(page, card.getByRole("button", { name: /Arrastar/ }), tomorrowCol);
      await saved;
      await page.reload();
      await expect(page.getByTestId("demands-week").locator("section").filter({ hasText: "Amanhã" })).toContainText(
        title,
      );
      await expect(page.getByTestId("kpi-hoje").locator("p").first()).toHaveText(String(before));
    }
    await expectNoHorizontalScroll(page);
  });
});

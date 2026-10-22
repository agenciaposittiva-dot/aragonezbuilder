import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Rotina (tarefas recorrentes) e Referências da Biblioteca: criar pelo modal,
 * ver a prévia das próximas datas, pausar, retomar e excluir com confirmação;
 * salvar um link do YouTube (miniatura e origem reconhecidas), filtrar e
 * excluir. Nomes únicos por execução.
 */

const ORG = `/w/${DEMO.org}`;

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

function actionResponse(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
}

test("rotina: criar semanal com prévia, pausar, retomar e excluir", async ({ page }) => {
  await enter(page);
  await page.goto(`${ORG}/rotina`);
  await expect(page.getByRole("heading", { name: "Rotina", level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const title = `Relatório semanal ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Nova rotina" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByLabel("Projeto").selectOption({ index: 1 });
  await dialog.getByLabel("Dia da semana").selectOption({ label: "Sexta" });
  await expect(dialog.getByTestId("routine-preview")).toContainText("Toda sexta-feira");
  const created = actionResponse(page);
  await dialog.getByRole("button", { name: "Criar rotina" }).click();
  await created;
  const row = page.getByRole("row").filter({ hasText: title });
  await expect(row).toBeVisible();

  const paused = actionResponse(page);
  await row.getByRole("button", { name: `Pausar ${title}` }).click();
  await paused;
  await expect(row.getByText("Pausada").filter({ visible: true })).toBeVisible();
  const resumed = actionResponse(page);
  await row.getByRole("button", { name: `Retomar ${title}` }).click();
  await resumed;
  await expect(row.getByRole("button", { name: `Pausar ${title}` })).toBeVisible();
  await expect(row.getByText("Pausada").filter({ visible: true })).toHaveCount(0);

  await row.getByRole("button", { name: `Excluir ${title}` }).click();
  const removed = actionResponse(page);
  await page.getByRole("dialog").getByRole("button", { name: "Excluir rotina" }).click();
  await removed;
  await expect(page.getByRole("row").filter({ hasText: title })).toHaveCount(0);
});

// PNG 1×1: a miniatura do YouTube é servida localmente (o teste não depende da internet).
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("referências: salvar link do YouTube, filtrar por origem e excluir", async ({ page }) => {
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ body: PIXEL, contentType: "image/png" }));
  await enter(page);
  await page.goto(`${ORG}/files`);
  await page.getByRole("link", { name: "Referências" }).click();
  await expect(page).toHaveURL(/\/files\/referencias/);
  await expectNoHorizontalScroll(page);
  const title = `Inspiração reels ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Nova referência" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await expect(dialog.getByText("Origem: YouTube")).toBeVisible();
  await dialog.getByLabel("Título").fill(title);
  await dialog.getByLabel("Etiquetas").fill("Reels, Tipografia");
  const saved = actionResponse(page);
  await dialog.getByRole("button", { name: "Salvar referência" }).click();
  await saved;
  const card = page.getByTestId("references").locator("li").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("YouTube", { exact: true })).toBeVisible();
  await expect(card.locator("img")).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  await expect(card.getByText("#reels")).toBeVisible();

  await page.getByRole("combobox", { name: "Todas as origens" }).selectOption("pinterest");
  await expect(page).toHaveURL(/origem=pinterest/);
  await expect(page.getByTestId("references").locator("li").filter({ hasText: title })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Todas as origens" }).selectOption("youtube");
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: `Excluir ${title}` }).click();
  const removed = actionResponse(page);
  await page.getByRole("dialog").getByRole("button", { name: "Excluir" }).click();
  await removed;
  await expect(page.getByTestId("references").locator("li").filter({ hasText: title })).toHaveCount(0);
});

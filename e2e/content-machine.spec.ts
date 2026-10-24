import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Máquina de Conteúdo de ponta a ponta (provedor de demonstração): escolher a
 * marca, informar a ideia, analisar a oportunidade (hipótese editorial, sem
 * dados inventados), gerar e escolher o ângulo, definir formato, gerar o
 * carrossel com progresso real, ver os slides, abrir editor e prévia, planejar
 * no calendário e retomar o projeto depois (salvo e recuperável).
 */

const ORG = `/w/${DEMO.org}`;

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

const step = (page: Page, n: number) => page.getByTestId(`machine-step-${n}`);
const next = (page: Page) => page.getByTestId("machine-continue");

test.describe("Máquina de Conteúdo", () => {
  test.setTimeout(300_000);

  test("do assunto ao calendário, com projeto salvo e retomado", async ({ page }, info) => {
    const tag = `${info.project.name}-${Date.now().toString(36)}`;
    await enter(page);
    await page.goto(`${ORG}/maquina`);
    await expect(page.getByRole("heading", { name: "Máquina de Conteúdo" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // 1. Marca.
    await page.getByRole("button", { name: "Novo conteúdo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Novo conteúdo na Máquina" });
    await dialog.getByLabel("Nome do projeto").fill(`Máquina e2e ${tag}`);
    await dialog.getByRole("button", { name: "Começar" }).click();
    await page.waitForURL(/\/maquina\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const projectUrl = page.url();

    // 2. Assunto (ideia própria) e oportunidade: hipótese editorial, não "em alta".
    await expect(step(page, 2)).toBeVisible();
    await page.getByLabel("Qual é a ideia?").fill(`Como escolher o café certo para cada preparo ${tag}`);
    await expect(page.getByTestId("machine-source")).toContainText("Ideia própria");
    await page.getByTestId("machine-research").click();
    const opportunity = page.getByTestId("machine-opportunity");
    await expect(opportunity).toBeVisible({ timeout: 60_000 });
    await expect(opportunity).toContainText("Hipótese editorial");
    await expect(opportunity).not.toContainText("Em alta");
    await expectNoHorizontalScroll(page);

    // 3. Ângulos: gerar, escolher um.
    await next(page).click();
    await expect(step(page, 3)).toBeVisible();
    await page.getByTestId("machine-angles").click();
    const angles = page.getByTestId("machine-angle");
    await expect(angles).toHaveCount(5, { timeout: 60_000 });
    await angles.first().getByRole("radio").click();
    await expect(angles.first().getByRole("radio")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Gancho")).toBeVisible();

    // 4. Formato e objetivo.
    await next(page).click();
    await expect(step(page, 4)).toBeVisible();
    await page.getByLabel("Quantidade de slides").selectOption("5");
    await page.getByLabel("Imagens").selectOption("none");
    await expectNoHorizontalScroll(page);

    // 5. Geração com progresso; ao terminar, a etapa 6 mostra os slides.
    await next(page).click();
    await expect(step(page, 5)).toBeVisible();
    await expect(page.getByTestId("machine-save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await page.getByTestId("machine-generate").click();
    await expect(page.getByText("Planejando a narrativa")).toBeVisible();
    await expect(step(page, 6)).toBeVisible({ timeout: 180_000 });
    const pages = page.getByTestId("machine-pages").locator("li");
    await expect(pages).toHaveCount(5);
    await expect(pages.first().locator("img")).toBeVisible({ timeout: 60_000 });
    await expectNoHorizontalScroll(page);

    // 7. Editor e 8. prévia (links para os módulos existentes).
    await next(page).click();
    await expect(page.getByTestId("machine-open-editor")).toHaveAttribute("href", /\/studio\/[0-9a-f-]{36}$/);
    await next(page).click();
    await expect(page.getByTestId("machine-open-preview")).toHaveAttribute("href", /\/content\/[0-9a-f-]{36}\/preview$/);

    // 9. Calendário.
    await next(page).click();
    await expect(step(page, 9)).toBeVisible();
    await page.getByLabel("Data planejada").fill("2026-12-10");
    await page.getByRole("button", { name: "Salvar data" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Data planejada" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Retomar: o projeto volta na mesma etapa, com as decisões.
    await expect(page.getByTestId("machine-save-state")).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await page.goto(projectUrl);
    await expect(step(page, 9)).toBeVisible();
    await expect(page.getByLabel("Data planejada")).toHaveValue("2026-12-10");
    await page.getByRole("button", { name: /Ângulo/ }).click();
    await expect(page.getByTestId("machine-angle").first().getByRole("radio")).toHaveAttribute("aria-checked", "true");

    await page.goto(`${ORG}/maquina`);
    const card = page.getByTestId("machine-project").filter({ hasText: `Máquina e2e ${tag}` });
    await expect(card).toContainText("Pronto para revisar");
  });
});

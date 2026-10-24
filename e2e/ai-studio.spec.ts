import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Criação com IA (Assistente), com a agência de demonstração (provedor local):
 * sugestão de tarefas revisável, histórico que reabre o resultado estruturado
 * como lista (não como JSON), texto gerado que vira demanda com um clique
 * (formulário completo pré-preenchido) e projeto na geração de imagem.
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

const opButton = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Operações" }).getByRole("button", { name: label, exact: true });

test.describe("assistente de IA", () => {
  test("sugestão de tarefas, histórico sem JSON cru, texto vira demanda e projeto na imagem", async ({ page }) => {
    await enter(page);
    const topic = `Lançamento ${Date.now().toString(36)}`;
    await page.goto(`${ORG}/ai`);
    await page.waitForLoadState("networkidle");

    // Sugestão de tarefas (estruturada): lista revisável, nada criado sem confirmar.
    await opButton(page, "Sugestão de tarefas").click();
    await page.locator("#ai-project").selectOption({ index: 1 });
    await page.fill("#ai-topic", topic);
    await page.getByRole("button", { name: "Gerar", exact: true }).click();
    const tasks = page.getByTestId("ai-tasks");
    await expect(tasks).toBeVisible({ timeout: 60_000 });
    await expect(tasks.locator("li")).toHaveCount(4);

    // Histórico: reabrir o item estruturado mostra a lista de tarefas, não o JSON.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: new RegExp(topic) })
      .first()
      .click();
    await expect(page.getByTestId("ai-tasks")).toBeVisible();
    await expect(page.getByTestId("ai-tasks").locator("li")).toHaveCount(4);
    await expect(page.locator("body")).not.toContainText('"tasks":');

    // Texto gerado → demanda com um clique (formulário completo, descrição pré-preenchida).
    await opButton(page, "Legendas").click();
    await page.fill("#ai-topic", topic);
    await page.getByRole("button", { name: "Gerar", exact: true }).click();
    await expect(page.getByTestId("ai-copy")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("ai-to-task").click();
    const dialog = page.getByRole("dialog", { name: "Nova demanda" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#t-title")).toHaveValue(new RegExp(`^Legendas: ${topic}`));
    await expect(dialog.locator("#t-desc")).toHaveValue(/Modo demonstração/);
    await dialog.locator("#t-project").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: /^Criar/ }).click();
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).toContainText(`Legendas: ${topic}`);
    await expect(page.locator("body")).toContainText("Modo demonstração");

    // Gerar imagem: o projeto pode ser escolhido (a imagem é salva nele em Arquivos).
    await page.goto(`${ORG}/ai?ferramenta=imagem`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#ai-image-project")).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

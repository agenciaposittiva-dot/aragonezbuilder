import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Nuvem central e salvamento automático: cada teste cria a própria arte e
 * confere o que de fato ficou no servidor (recarregando, em outra sessão ou
 * depois de falhas simuladas).
 */

const ORG = `/w/${DEMO.org}`;
const SAVED = "Todas as alterações salvas";

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

async function newDesign(page: Page, name: string) {
  await page.goto(`${ORG}/studio`);
  await page.getByRole("button", { name: "Nova arte" }).first().click();
  await page.fill("#d-name", name);
  await page.getByRole("button", { name: "Criar e abrir editor" }).click();
  await page.waitForURL(/\/studio\/[0-9a-f-]{36}$/);
  await editorReady(page);
  return page.url();
}

/** A cena só aceita edições depois de montada (o canvas aparece antes). */
async function editorReady(page: Page) {
  await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
}

const indicator = (page: Page) => page.locator("[data-save-state]").first();

/** Espera uma nova confirmação do servidor (não basta o estado inicial "salvo"). */
async function waitServerSave(page: Page, after = "") {
  await expect(indicator(page)).toHaveAttribute("data-save-state", "saved", { timeout: 30_000 });
  await expect
    .poll(async () => (await indicator(page).getAttribute("data-saved-at")) ?? "", { timeout: 30_000 })
    .not.toBe(after);
  return (await indicator(page).getAttribute("data-saved-at")) ?? "";
}

async function addTitle(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1200) < 1024;
  if (mobile) {
    await page.getByRole("navigation", { name: "Ferramentas" }).getByRole("button", { name: "Adicionar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Adicionar título" }).click();
    await page.keyboard.press("Escape");
  } else {
    await page.getByRole("button", { name: "Adicionar título" }).click();
  }
}

async function layerCount(page: Page, label = "Título") {
  await editorReady(page);
  const mobile = (page.viewportSize()?.width ?? 1200) < 1024;
  if (mobile) {
    await page.getByRole("navigation", { name: "Ferramentas" }).getByRole("button", { name: "Camadas" }).click();
    const n = await page.getByRole("dialog").getByText(label, { exact: true }).count();
    await page.keyboard.press("Escape");
    return n;
  }
  await page.getByRole("button", { name: "Camadas" }).click();
  return page.locator("aside").getByText(label, { exact: true }).count();
}

test.describe("nuvem e salvamento automático", () => {
  test("arte salva sozinha, sobrevive a recarregar e a uma nova sessão", async ({ page, browser }) => {
    await enter(page);
    const url = await newDesign(page, `Nuvem ${Date.now().toString(36)}`);
    await addTitle(page);
    await waitServerSave(page);
    await expect(indicator(page)).toContainText(SAVED);
    await page.reload();
    await editorReady(page);
    await expect.poll(() => layerCount(page)).toBe(1);
    await expectNoHorizontalScroll(page);

    // Nova sessão (outro navegador, nova autenticação).
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await other.newPage();
    await enter(p2);
    await p2.goto(url);
    await editorReady(p2);
    await expect.poll(() => layerCount(p2)).toBe(1);
    await other.close();
  });

  test("sem conexão: fica pendente, guarda no aparelho e salva quando a rede volta", async ({ page, context }) => {
    await enter(page);
    const url = await newDesign(page, `Offline ${Date.now().toString(36)}`);
    await context.setOffline(true);
    await addTitle(page);
    await expect(indicator(page)).toHaveAttribute("data-save-state", "offline", { timeout: 20_000 });
    await expect(indicator(page)).toContainText("Sem conexão — alterações pendentes");
    await context.setOffline(false);
    await waitServerSave(page);
    await page.goto(url);
    await expect.poll(() => layerCount(page)).toBe(1);
  });

  test("aba fechada sem conexão: o rascunho do aparelho é recuperado", async ({ page, context }) => {
    await enter(page);
    const url = await newDesign(page, `Rascunho ${Date.now().toString(36)}`);
    await context.setOffline(true);
    await addTitle(page);
    await expect(indicator(page)).toHaveAttribute("data-save-state", "offline", { timeout: 20_000 });
    // Dá tempo de a cópia local ser gravada e fecha a aba sem salvar.
    await page.waitForTimeout(800);
    await page.close({ runBeforeUnload: false });
    await context.setOffline(false);
    const p2 = await context.newPage();
    await p2.goto(url);
    await expect(p2.getByRole("alert").filter({ hasText: "não chegaram ao servidor" })).toBeVisible({ timeout: 20_000 });
    await p2.getByRole("button", { name: "Recuperar alterações" }).click();
    await waitServerSave(p2);
    await p2.reload();
    await expect.poll(() => layerCount(p2)).toBe(1);
    await expect(p2.getByRole("alert").filter({ hasText: "não chegaram ao servidor" })).toHaveCount(0);
  });

  test("falha do servidor: nunca mostra salvo e tenta de novo", async ({ page }) => {
    await enter(page);
    await newDesign(page, `Falha ${Date.now().toString(36)}`);
    let fail = true;
    await page.route("**/studio/**", (route) =>
      fail && route.request().method() === "POST" && route.request().headers()["next-action"]
        ? route.fulfill({ status: 500, body: "erro" })
        : route.continue(),
    );
    await addTitle(page);
    await expect(indicator(page)).toHaveAttribute("data-save-state", "error", { timeout: 20_000 });
    await expect(indicator(page)).toContainText("Erro ao salvar — tentar novamente");
    await expect(page.getByText(SAVED)).toHaveCount(0);
    fail = false;
    await indicator(page).click();
    await waitServerSave(page);
  });

  test("duas sessões na mesma arte: conflito revisado sem perder nada", async ({ page, browser }) => {
    await enter(page);
    const url = await newDesign(page, `Conflito ${Date.now().toString(36)}`);
    const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const p2 = await other.newPage();
    await enter(p2);
    await p2.goto(url);
    await editorReady(p2);

    await addTitle(page);
    await waitServerSave(page);
    await addTitle(p2);
    const dialog = p2.getByRole("dialog", { name: "Esta arte foi alterada em outra sessão" });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole("button", { name: "Manter as minhas alterações" }).click();
    await expect(p2.locator("[data-sonner-toast]").filter({ hasText: "A outra versão ficou no histórico" })).toBeVisible();
    await expect(indicator(p2)).toHaveAttribute("data-save-state", "saved");

    await p2.getByRole("button", { name: "Histórico de versões" }).click();
    await expect(p2.getByTestId("design-versions").getByText("Versão de outra sessão (conflito de edição)")).toBeVisible();
    await other.close();
  });

  test("versão nomeada e restauração sem perder o histórico", async ({ page }) => {
    await enter(page);
    await newDesign(page, `Versões ${Date.now().toString(36)}`);
    await addTitle(page);
    const first = await waitServerSave(page);
    await page.getByRole("button", { name: "Histórico de versões" }).click();
    await page.getByLabel("Nome da versão").fill("Com um título");
    await page.getByRole("button", { name: "Salvar versão" }).click();
    const list = page.getByTestId("design-versions");
    await expect(list.getByText("Com um título")).toBeVisible();
    await page.keyboard.press("Escape");

    await addTitle(page);
    await waitServerSave(page, first);
    await expect.poll(() => layerCount(page)).toBe(2);

    await page.getByRole("button", { name: "Histórico de versões" }).click();
    const named = list.locator("li").filter({ hasText: "Com um título" });
    await named.getByRole("button", { name: "Comparar com a atual" }).click();
    await expect(named).toContainText("+ Texto “Seu título aqui”");
    const versionsBefore = await list.locator(":scope > li").count();
    await named.getByRole("button", { name: "Restaurar" }).click();
    await page.getByRole("dialog", { name: /Restaurar a versão/ }).getByRole("button", { name: "Restaurar" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "restaurada" })).toBeVisible();
    await expect.poll(() => list.locator(":scope > li").count()).toBe(versionsBefore + 2);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect.poll(() => layerCount(page)).toBe(1);
  });
});

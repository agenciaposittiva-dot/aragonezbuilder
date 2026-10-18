import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Exclusão com lixeira (clientes, projetos, artes e agência). Cada teste cria o
 * próprio registro pela interface e o remove de verdade no servidor.
 */

const ORG = `/w/${DEMO.org}`;

/** Entra e espera sair do login (para a agência ou, com várias, para o seletor). */
async function enter(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

async function createClient(page: Page, name: string) {
  await page.goto(`${ORG}/clients`);
  await page.getByRole("button", { name: "Novo cliente" }).first().click();
  await page.fill("#c-name", name);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  return page.url().split("/clients/")[1]!.split(/[/?#]/)[0]!;
}

async function openClientDelete(page: Page) {
  await page.getByRole("button", { name: "Mais ações" }).click();
  await page.getByRole("menuitem", { name: "Excluir cliente" }).click();
  return page.getByRole("dialog");
}

test.describe("excluir com lixeira", () => {
  test("cancelar não altera nada; excluir tira da lista e persiste após recarregar; restaurar devolve", async ({
    page,
  }) => {
    const name = `E2E Lixeira ${Date.now().toString(36)}`;
    await enter(page, DEMO.owner);
    const id = await createClient(page, name);

    // Cancelar.
    let dialog = await openClientDelete(page);
    await expect(dialog.getByRole("heading")).toContainText(name);
    await expect(dialog).toContainText("Nenhum outro conteúdo é afetado");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // Excluir de verdade.
    dialog = await openClientDelete(page);
    await dialog.getByRole("button", { name: "Mover para a lixeira" }).click();
    await page.waitForURL(new RegExp(`${ORG}/clients$`));
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "movido para a lixeira" })).toBeVisible();
    await expect(page.getByText(name)).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(name)).toHaveCount(0);
    // O endereço antigo não abre mais.
    await page.goto(`${ORG}/clients/${id}`);
    await expect(page.getByText(name)).toHaveCount(0);

    // Lixeira → restaurar.
    await page.goto(`${ORG}/trash`);
    const row = page.locator("li").filter({ hasText: name });
    await expect(row).toContainText("Cliente");
    await expectNoHorizontalScroll(page);
    await row.getByRole("button", { name: "Restaurar" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "restaurado" })).toBeVisible();
    await page.goto(`${ORG}/clients`);
    await expect(page.getByText(name)).toBeVisible();

    // Excluir de novo e apagar definitivamente.
    await page.goto(`${ORG}/clients/${id}`);
    dialog = await openClientDelete(page);
    await dialog.getByRole("button", { name: "Mover para a lixeira" }).click();
    await page.waitForURL(new RegExp(`${ORG}/clients$`));
    await page.goto(`${ORG}/trash`);
    await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Excluir definitivamente" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("não pode ser desfeito");
    await confirm.getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "excluído definitivamente" })).toBeVisible();
    await page.reload();
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("falha do servidor mantém o cliente e mostra o erro", async ({ page }) => {
    const name = `E2E Falha ${Date.now().toString(36)}`;
    await enter(page, DEMO.owner);
    await createClient(page, name);
    const dialog = await openClientDelete(page);
    await expect(dialog).toContainText("Nenhum outro conteúdo é afetado");
    // Derruba a próxima chamada de ação do servidor (a exclusão).
    await page.route("**/*", (route) =>
      route.request().method() === "POST" && route.request().headers()["next-action"]
        ? route.abort("failed")
        : route.continue(),
    );
    await dialog.getByRole("button", { name: "Mover para a lixeira" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Nada foi excluído");
    await expect(dialog).toBeVisible();
    await page.unroute("**/*");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("quem não tem permissão não vê a opção nem a lixeira", async ({ page }) => {
    await enter(page, "marina@demo.aragonez.app");
    await page.goto(`${ORG}/clients`);
    await page.locator("a[href*='/clients/']").first().click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
    await expect(page.getByRole("button", { name: "Mais ações" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Lixeira" })).toHaveCount(0);
    // Com streaming (loading.tsx) o status HTTP é 200; o conteúdo é a página de "não encontrado".
    await page.goto(`${ORG}/trash`);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
  });

  test("agência: proprietário exclui digitando o nome e restaura", async ({ page }) => {
    // Conta nova: não cria agências extras nas contas de demonstração.
    const tag = Date.now().toString(36);
    const name = `Agência E2E ${tag}`;
    await page.goto("/signup");
    await page.fill("#name", "Pessoa Lixeira");
    await page.fill("#email", `lixeira-${tag}@teste.dev`);
    await page.fill("#password", "senha-lixeira-2026");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await page.fill("#name", name);
    await page.getByRole("button", { name: "Criar agência" }).click();
    await page.waitForURL(/\/w\/agencia-e2e/, { timeout: 60_000 });
    const slug = new URL(page.url()).pathname.split("/")[2]!;

    await page.goto(`/w/${slug}/settings`);
    await page.getByRole("button", { name: "Excluir agência" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Excluir agência" });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("outro nome");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill(name);
    await confirm.click();
    await page.waitForURL(/\/onboarding\?excluida=/);
    await expect(page.getByText("Agências na lixeira")).toBeVisible();

    // Sem acesso enquanto estiver na lixeira.
    await page.goto(`/w/${slug}`);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();

    await page.goto("/onboarding");
    await page.locator("li").filter({ hasText: name }).getByRole("button", { name: "Restaurar" }).click();
    await page.waitForURL(new RegExp(`/w/${slug}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Pessoa");
  });
});

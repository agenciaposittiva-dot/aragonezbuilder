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
  // Em `next dev` o selo das ferramentas de desenvolvimento cobre a barra inferior do editor no celular.
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
    await expect(p2.getByRole("alert").filter({ hasText: "não chegaram ao servidor" })).toBeVisible({
      timeout: 20_000,
    });
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
    await expect(
      p2.locator("[data-sonner-toast]").filter({ hasText: "A outra versão ficou no histórico" }),
    ).toBeVisible();
    await expect(indicator(p2)).toHaveAttribute("data-save-state", "saved");

    await p2.getByRole("button", { name: "Histórico de versões" }).click();
    await expect(
      p2.getByTestId("design-versions").getByText("Versão de outra sessão (conflito de edição)"),
    ).toBeVisible();
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
    await page
      .getByRole("dialog", { name: /Restaurar a versão/ })
      .getByRole("button", { name: "Restaurar" })
      .click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "restaurada" })).toBeVisible();
    await expect.poll(() => list.locator(":scope > li").count()).toBe(versionsBefore + 2);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect.poll(() => layerCount(page)).toBe(1);
  });
});

test.describe("rascunhos fora do editor", () => {
  test("personalização do portal: rascunho salva sozinho e a falha de rede não perde a edição", async ({
    page,
    context,
  }) => {
    await enter(page);
    const tag = Date.now().toString(36);
    await page.goto(`${ORG}/clients`);
    await page.getByRole("button", { name: "Novo cliente" }).first().click();
    await page.fill("#c-name", `Portal ${tag}`);
    await page.getByRole("dialog").locator("button[type=submit]").click();
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
    const portalUrl = `${page.url().split(/[?#]/)[0]}/portal`;
    await page.goto(portalUrl);

    await page.fill("#pc-name", `Marca ${tag}`);
    await waitServerSave(page);
    await expect(indicator(page)).toContainText(SAVED);
    await page.reload();
    await expect(page.locator("#pc-name")).toHaveValue(`Marca ${tag}`);

    // Sem rede: fica pendente; a aba fecha; a edição volta do aparelho.
    await context.setOffline(true);
    await page.fill("#pc-name", `Marca ${tag} offline`);
    await expect(indicator(page)).toHaveAttribute("data-save-state", "offline", { timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.close({ runBeforeUnload: false });
    await context.setOffline(false);
    const p2 = await context.newPage();
    await p2.goto(portalUrl);
    await expect(p2.locator("#pc-name")).toHaveValue(`Marca ${tag}`);
    await p2.getByRole("button", { name: "Recuperar alterações" }).click();
    await waitServerSave(p2);
    await p2.reload();
    await expect(p2.locator("#pc-name")).toHaveValue(`Marca ${tag} offline`);
    await expectNoHorizontalScroll(p2);
  });

  test("nova solicitação: o preenchimento não enviado volta depois de recarregar", async ({ page }) => {
    await enter(page);
    const title = `Briefing ${Date.now().toString(36)}`;
    await page.goto(`${ORG}/requests/new`);
    await page.fill("#rq-title", title);
    await page.fill("#rq-objective", "Lançamento da nova linha");
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "ainda não enviou" })).toBeVisible();
    await expect(page.locator("#rq-title")).toHaveValue(title);
    await expect(page.locator("#rq-objective")).toHaveValue("Lançamento da nova linha");
    await page.getByRole("button", { name: "Descartar rascunho" }).click();
    await expect(page.locator("#rq-title")).toHaveValue("");
    await page.reload();
    await expect(page.locator("#rq-title")).toHaveValue("");
    await expect(page.getByRole("status").filter({ hasText: "ainda não enviou" })).toHaveCount(0);
  });
});

// PNG 1×1 válido (o editor carrega a imagem de verdade no canvas).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function uploadToCloud(page: Page, name: string) {
  await page.goto(`${ORG}/files`);
  await page.getByRole("button", { name: "Enviar arquivos" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Enviar arquivos" });
  await dialog.getByLabel("Escolher arquivos").setInputFiles({ name, mimeType: "image/png", buffer: PNG });
  await dialog.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "1 arquivo(s) enviado(s)" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog).toBeHidden();
}

async function openFileMenu(page: Page, name: string) {
  await page.goto(`${ORG}/files?q=${encodeURIComponent(name.replace(/\.png$/, ""))}`);
  // Um clique antes da hidratação (servidor de desenvolvimento compilando) não abre o menu: tenta de novo.
  await expect(async () => {
    await page
      .getByRole("button", { name: `Ações de ${name}` })
      .first()
      .click();
    await expect(page.getByRole("menu")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

const toast = (page: Page, text: string) => page.locator("[data-sonner-toast]").filter({ hasText: text });

test.describe("Minha Nuvem", () => {
  test("enviar, baixar, renomear, duplicar, excluir e recuperar da Lixeira", async ({ page }) => {
    await enter(page);
    const tag = Date.now().toString(36);
    const name = `nuvem-${tag}.png`;
    await uploadToCloud(page, name);
    await expect(page.getByTestId("storage-meter")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Baixar: o link estável passa pela autorização e devolve os mesmos bytes.
    await openFileMenu(page, name);
    const href = await page.getByRole("menuitem", { name: "Baixar" }).getAttribute("href");
    expect(href).toMatch(/^\/api\/files\/[0-9a-f-]{36}\?download=1$/);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(Buffer.compare(await res.body(), PNG)).toBe(0);
    await page.keyboard.press("Escape");

    // Renomear.
    const renamed = `nuvem-${tag}-capa.png`;
    await openFileMenu(page, name);
    await page.getByRole("menuitem", { name: "Renomear" }).click();
    await page.getByRole("dialog").getByLabel("Nome").fill(renamed);
    await page.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await expect(toast(page, "Arquivo atualizado")).toBeVisible();

    // Duplicar.
    await openFileMenu(page, renamed);
    await page.getByRole("menuitem", { name: "Duplicar" }).click();
    await expect(toast(page, "Cópia criada")).toBeVisible();
    const copy = `nuvem-${tag}-capa (cópia).png`;
    await page.reload();
    await expect(page.getByText(copy).first()).toBeVisible();

    // Excluir a cópia → Lixeira → restaurar.
    await page
      .getByRole("button", { name: `Ações de ${copy}` })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    const del = page.getByRole("dialog", { name: `Excluir “${copy}”?` });
    await expect(del).toContainText("30 dias");
    await del.getByRole("button", { name: "Mover para a lixeira" }).click();
    await expect(toast(page, "foi para a lixeira")).toBeVisible();
    await page.reload();
    await expect(page.getByText(copy)).toHaveCount(0);

    await page.goto(`${ORG}/trash`);
    const row = page.locator("li").filter({ hasText: copy });
    await expect(row).toContainText("Arquivo");
    await expectNoHorizontalScroll(page);
    await row.getByRole("button", { name: "Restaurar" }).click();
    await expect(toast(page, "restaurado")).toBeVisible();
    await openFileMenu(page, copy);
    await expect(page.getByRole("menuitem", { name: "Baixar" })).toBeVisible();
  });

  test("imagem usada em uma arte avisa antes de excluir", async ({ page }) => {
    await enter(page);
    const tag = Date.now().toString(36);
    const name = `na-arte-${tag}.png`;
    const design = `Com imagem ${tag}`;
    await newDesign(page, design);
    await page
      .locator("input[type=file][accept='image/*']")
      .setInputFiles({ name, mimeType: "image/png", buffer: PNG });
    await waitServerSave(page);
    await expect.poll(() => layerCount(page, name)).toBe(1);

    await openFileMenu(page, name);
    await page.getByRole("menuitem", { name: "Excluir" }).click();
    const del = page.getByRole("dialog", { name: `Excluir “${name}”?` });
    await del.getByRole("button", { name: "Mover para a lixeira" }).click();
    await expect(del.getByRole("alert")).toContainText(design);
    await expect(del.getByRole("button", { name: "Excluir mesmo assim" })).toBeVisible();
    await del.getByRole("button", { name: "Cancelar" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: `Ações de ${name}` }).first()).toBeVisible();
  });

  test("ID adulterado e arquivo interno não abrem para quem não tem acesso", async ({ page, browser }) => {
    await enter(page);
    const name = `interno-${Date.now().toString(36)}.png`;
    await uploadToCloud(page, name);
    await openFileMenu(page, name);
    const href = (await page.getByRole("menuitem", { name: "Baixar" }).getAttribute("href"))!;
    await page.keyboard.press("Escape");

    expect((await page.request.get("/api/files/00000000-0000-4000-8000-000000000000")).status()).toBe(404);
    expect((await page.request.get("/api/files/..%2F..%2Fetc%2Fpasswd")).status()).toBe(404);

    // Cliente do portal: o arquivo interno (não compartilhado) não existe para ele.
    const other = await browser.newContext();
    const guest = await other.newPage();
    await login(guest, DEMO.guest, `/portal/${DEMO.org}/${DEMO.guestClient}/entrar`);
    await guest.waitForURL((u) => u.pathname.startsWith("/portal/") && !u.pathname.endsWith("/entrar"), {
      timeout: 60_000,
    });
    expect((await guest.request.get(href, { maxRedirects: 0 })).status()).toBe(404);
    // Sem sessão também não recebe o link assinado.
    const anon = await browser.newContext();
    expect((await anon.request.get(href, { maxRedirects: 0 })).status()).not.toBe(302);
    await anon.close();
    await other.close();
  });
});

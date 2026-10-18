import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Foto de perfil com conta nova (não mexe nas contas de demonstração):
 * enviar e enquadrar, falha do servidor sem falso "salvo", persistência após
 * recarregar e após sair/entrar, troca e remoção, avatar no menu e no chat sem
 * recarregar, proteção contra alterar/ver a foto de outra pessoa, e nome e
 * senha continuando a funcionar.
 */

async function photo(color: string, width = 900, height = 600) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

const menuAvatar = (page: Page) => page.getByRole("button", { name: "Menu do perfil" }).locator("img");

async function choose(page: Page, buffer: Buffer, name = "foto.jpg", mimeType = "image/jpeg") {
  await page.getByTestId("profile-photo-input").setInputFiles({ name, mimeType, buffer });
}

async function saveDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Ajustar foto" });
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/user-avatar") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Salvar foto" }).click();
  const res = await saved;
  expect(res.ok()).toBe(true);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("profile-photo-status")).toHaveText(/Foto de perfil salva/);
  return page.getByTestId("profile-photo-current").getAttribute("src") as Promise<string>;
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Menu do perfil" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await page.waitForURL(/\/login/);
}

test.describe("foto de perfil", () => {
  test("enviar, enquadrar, persistir, trocar, remover e aparecer no menu e no chat", async ({
    page,
    browser,
  }, info) => {
    const mobile = info.project.name === "mobile";
    const tag = `${info.project.name}-${Date.now().toString(36)}`;
    const email = `foto-${tag}@teste.dev`;
    let password = "senha-foto-2026";

    await page.goto("/signup");
    await page.fill("#name", "Pessoa Foto");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
    await page.fill("#name", `Agência Foto ${tag}`);
    await page.getByRole("button", { name: "Criar agência" }).click();
    await page.waitForURL(/\/w\/agencia-foto-/, { timeout: 60_000 });
    const org = new URL(page.url()).pathname.split("/")[2]!;
    const account = `/w/${org}/account`;

    // Seção antes de "Dados pessoais", com iniciais enquanto não há foto.
    await page.goto(account);
    await page.waitForLoadState("networkidle");
    const photoTitle = page.getByText("Foto de perfil", { exact: true });
    const dataTitle = page.getByText("Dados pessoais", { exact: true });
    await expect(photoTitle).toBeVisible();
    expect((await photoTitle.boundingBox())!.y).toBeLessThan((await dataTitle.boundingBox())!.y);
    await expect(page.getByTestId("profile-photo-placeholder")).toHaveText("PF");
    await expect(page.getByRole("button", { name: "Enviar foto" })).toBeVisible();
    await expect(menuAvatar(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Arquivo inválido (texto com nome de imagem) e imagem pequena demais: nada é enviado.
    await choose(page, Buffer.from("isto não é uma imagem"), "foto.png", "image/png");
    await expect(page.getByTestId("profile-photo-status")).toHaveText(/Não foi possível abrir a imagem/);
    await choose(page, await photo("#888888", 20, 20));
    await expect(page.getByTestId("profile-photo-status")).toHaveText(/mínimo/);
    await choose(page, Buffer.from("GIF89a"), "foto.gif", "image/gif");
    await expect(page.getByTestId("profile-photo-status")).toHaveText(/Formato não aceito/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // O servidor também confere o conteúdo real.
    const fake = await page.request.post("/api/user-avatar", {
      multipart: { file: { name: "foto.jpg", mimeType: "image/jpeg", buffer: Buffer.from("falso") } },
    });
    expect(fake.status()).toBe(422);
    expect((await fake.json()).error).toMatch(/não é uma imagem válida/);

    // Enquadramento: prévia, zoom e cancelar não altera nada.
    await choose(page, await photo("#c0392b"));
    const dialog = page.getByRole("dialog", { name: "Ajustar foto" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("img", { name: "Foto em edição" })).toBeVisible();
    await expect(dialog.getByText("Perfil, chat e comentários.")).toBeVisible();
    const zoomText = dialog.getByText(/^\d+%$/);
    const before = await zoomText.textContent();
    await dialog.getByRole("button", { name: "Aumentar zoom" }).click();
    await expect(zoomText).not.toHaveText(before!);
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("profile-photo-placeholder")).toBeVisible();

    // Falha no servidor: a interface não diz que salvou e mantém a situação anterior.
    await choose(page, await photo("#c0392b"));
    await page.route("**/api/user-avatar", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { ok: false, error: "Falha simulada no servidor." } })
        : route.fallback(),
    );
    await dialog.getByRole("button", { name: "Salvar foto" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/Falha simulada no servidor\. A foto anterior foi mantida\./);
    await expect(page.getByTestId("profile-photo-status")).not.toHaveText(/Foto de perfil salva/);
    await page.unroute("**/api/user-avatar");

    // Envio real: arquivo gravado, perfil atualizado e avatar do menu trocado sem recarregar.
    const first = await saveDialog(page);
    expect(first).toMatch(/^\/api\/user-avatar\/[\w-]+\/[0-9a-f]{32}$/);
    await expect(menuAvatar(page)).toHaveAttribute("src", first);
    const userId = first.split("/")[3]!;
    const image = await page.request.get(first);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    expect((await sharp(await image.body()).metadata()).width).toBe(512);

    // Recarregar mantém a foto.
    await page.reload();
    await expect(page.getByTestId("profile-photo-current")).toHaveAttribute("src", first);
    expect(await page.getByTestId("profile-photo-current").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
      512,
    );
    await expect(page.getByRole("button", { name: "Alterar foto" })).toBeVisible();

    // Chat: a mensagem mostra a foto de quem enviou.
    await page.goto(`/w/${org}/chat`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Nova conversa" }).first().click();
    const newConv = page.getByRole("dialog");
    await newConv.getByRole("tab", { name: "Canal" }).click();
    await newConv.locator("#chat-channel-name").fill(`fotos-${tag}`);
    await newConv.getByRole("button", { name: "Criar canal" }).click();
    const composer = page.getByRole("textbox", { name: "Mensagem" });
    await composer.fill(`Olá com foto ${tag}`);
    await composer.press("Enter");
    const message = page.getByTestId("chat-message").filter({ hasText: `Olá com foto ${tag}` });
    await expect(message.locator("img").first()).toHaveAttribute("src", first);

    // Trocar a foto: a anterior sai do armazenamento e o menu acompanha.
    await page.goto(account);
    await page.waitForLoadState("networkidle");
    await choose(page, await photo("#1f618d", 600, 900), "nova.webp", "image/webp");
    const second = await saveDialog(page);
    expect(second).not.toBe(first);
    await expect(menuAvatar(page)).toHaveAttribute("src", second);
    expect((await page.request.get(first)).status()).toBe(404);

    // Não é possível trocar a foto de outra pessoa: a conta é sempre a da sessão.
    const forged = await page.request.post("/api/user-avatar", {
      multipart: {
        userId: "outra-pessoa",
        file: { name: "x.jpg", mimeType: "image/jpeg", buffer: await photo("#000000", 100, 100) },
      },
    });
    expect(forged.status()).toBe(201);
    const forgedSrc = (await forged.json()).src as string;
    expect(forgedSrc.split("/")[3]).toBe(userId);
    const crossSite = await page.request.post("/api/user-avatar", {
      headers: { origin: "https://site-malicioso.example" },
      multipart: { file: { name: "x.jpg", mimeType: "image/jpeg", buffer: await photo("#ffffff", 100, 100) } },
    });
    expect(crossSite.status()).toBe(403);
    // Volta para a foto escolhida na tela.
    await page.reload();
    await choose(page, await photo("#1f618d", 600, 900), "nova.webp", "image/webp");
    expect(await saveDialog(page)).toBe(second);

    // Quem não está logado, ou é de outra agência, não vê nem altera a foto.
    const anon = await browser.newContext({ baseURL: info.project.use.baseURL });
    expect((await anon.request.get(second)).status()).toBe(404);
    expect((await anon.request.delete("/api/user-avatar")).status()).toBe(401);
    await anon.close();
    const outsider = await browser.newContext({ baseURL: info.project.use.baseURL });
    const other = await outsider.newPage();
    await login(other, DEMO.owner);
    await other.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
    expect((await other.request.get(second)).status()).toBe(404);
    await outsider.close();

    // Nome e senha continuam funcionando.
    await page.fill("#acc-name", "Pessoa Foto Nova");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Perfil atualizado")).toBeVisible();
    await expect(page.locator("#acc-email")).toHaveValue(email);
    await page.fill("#pw-current", password);
    password = "senha-foto-nova-2026";
    await page.fill("#pw-next", password);
    await page.fill("#pw-confirm", password);
    await page.getByRole("button", { name: "Alterar senha" }).click();
    await expect(page.getByText(/Senha alterada/)).toBeVisible();

    // Sair e entrar de novo (com a senha nova): a foto continua lá.
    await signOut(page);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/w\//, { timeout: 60_000 });
    await page.goto(account);
    await expect(page.getByTestId("profile-photo-current")).toHaveAttribute("src", second);
    await expect(menuAvatar(page)).toHaveAttribute("src", second);
    await page.getByRole("button", { name: "Menu do perfil" }).click();
    await expect(page.getByRole("menu").getByText("Pessoa Foto Nova")).toBeVisible();
    await expect(page.getByRole("menu").locator("img")).toHaveAttribute("src", second);
    await page.keyboard.press("Escape");

    // Remover: volta às iniciais em todos os lugares.
    await page.getByRole("button", { name: "Remover foto" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remover foto" }).click();
    await expect(page.getByTestId("profile-photo-placeholder")).toHaveText("PN");
    await expect(menuAvatar(page)).toHaveCount(0);
    expect((await page.request.get(second)).status()).toBe(404);
    await page.reload();
    await expect(page.getByTestId("profile-photo-placeholder")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enviar foto" })).toBeVisible();
    if (mobile) await expectNoHorizontalScroll(page);
  });
});

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/** Logo larga com transparência (formato comum de logotipo). */
async function logoPng(color: string, width = 600, height = 200) {
  const mark = await sharp({ create: { width: height, height, channels: 4, background: color } })
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: Math.round((width - height) / 2), top: 0 }])
    .png()
    .toBuffer();
}

const settings = `/w/${DEMO.org}/settings`;

/** Entra e espera sair do login (vai para a agência ou, com várias agências, para o seletor). */
async function enter(page: Page, email: string) {
  await login(page, email);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

async function chooseLogo(page: Page, buffer: Buffer, name = "logo.png", mimeType = "image/png") {
  await page.getByTestId("org-logo-input").setInputFiles({ name, mimeType, buffer });
}

/** Logo exibida no seletor de agências (menu lateral no computador, menu recolhível no celular). */
async function switcherLogo(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1200) < 1024;
  if (mobile) await page.getByRole("button", { name: "Abrir menu" }).click();
  const img = page
    .locator(mobile ? "[role=dialog]" : "aside")
    .getByRole("button", { name: "Trocar de organização" })
    .locator("img");
  return { img, close: async () => mobile && (await page.keyboard.press("Escape")) };
}

test.describe("logo da agência", () => {
  test("cria agência com logo enquadrada e ela persiste depois de recarregar", async ({ page }) => {
    // Conta nova (não mexe nas agências das contas de demonstração).
    const tag = Date.now().toString(36);
    await page.goto("/signup");
    await page.fill("#name", "Pessoa Logo");
    await page.fill("#email", `logo-${tag}@teste.dev`);
    await page.fill("#password", "senha-logo-2026");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

    // Primeira agência, sem logo.
    const plain = `Agência Sem Logo ${tag}`;
    await page.fill("#name", plain);
    await expect(page.getByTestId("org-logo-placeholder")).toBeVisible();
    await page.getByRole("button", { name: "Criar agência" }).click();
    await page.waitForURL(/\/w\/agencia-sem-logo-/, { timeout: 60_000 });

    // Segunda agência, com logo enquadrada na criação.
    await page.goto("/onboarding");
    const name = `Agência Logo ${tag}`;
    await page.fill("#name", name);
    await chooseLogo(page, await logoPng("#c0392b"));
    const dialog = page.getByRole("dialog", { name: "Ajustar logo" });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await dialog.locator("#logo-zoom").fill("60");
    await dialog.getByRole("button", { name: "Usar esta logo" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Criar agência" }).click();
    await page.waitForURL(/\/w\/agencia-logo-/, { timeout: 60_000 });

    const { img, close } = await switcherLogo(page);
    await expect(img).toHaveAttribute("src", /\/api\/org-logo\/[0-9a-f-]{36}\?v=[0-9a-f]{16}/);
    const src = (await img.getAttribute("src"))!;
    await close();
    const res = await page.request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
    expect(res.headers()["cache-control"]).toContain("private");

    await page.reload();
    const after = await switcherLogo(page);
    await expect(after.img).toHaveAttribute("src", src);
    await after.close();

    // Seletor de agências: a logo aparece só na agência dona dela.
    // Espera a página hidratar: senão a lembrança da agência regrava o cookie depois de apagado.
    await page.waitForLoadState("networkidle");
    await page.context().clearCookies({ name: "last_org" });
    await page.goto("/");
    await expect(page.getByRole("link", { name: new RegExp(name) }).locator("img")).toHaveAttribute("src", src);
    await expect(page.getByRole("link", { name: new RegExp(plain) }).locator("img")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("altera, cancela e remove a logo nas configurações", async ({ page }) => {
    await enter(page, DEMO.owner);
    await page.goto(settings);
    await expect(page.getByText("Logo da agência").first()).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Cancelar não altera nada.
    await chooseLogo(page, await logoPng("#1f3a5f"));
    const dialog = page.getByRole("dialog", { name: "Ajustar logo" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("org-logo-status")).toHaveCount(0);

    // Enquadra (arrastar + zoom) e confirma.
    await chooseLogo(page, await logoPng("#1f3a5f"));
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Preencher o quadro" }).click();
    const frame = dialog.getByTestId("logo-crop-frame");
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await frame.focus();
    await page.keyboard.press("-");
    await dialog.getByText("Escuro", { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Escuro" })).toBeChecked();
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("org-logo-status")).toHaveText(/Logo salva/);
    const current = page.getByTestId("org-logo-current");
    await expect(current).toHaveAttribute("src", /\/api\/org-logo\//);
    const src = (await current.getAttribute("src"))!;

    // Persistência: recarregar mantém a logo no perfil e no seletor.
    await page.reload();
    await expect(page.getByTestId("org-logo-current")).toHaveAttribute("src", src);
    const sw = await switcherLogo(page);
    await expect(sw.img).toHaveAttribute("src", src);
    await sw.close();

    // Remover pede confirmação; cancelar mantém.
    await page.getByRole("button", { name: "Remover logo" }).click();
    const confirm = page.getByRole("dialog", { name: "Remover a logo da agência?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByTestId("org-logo-current")).toBeVisible();
    await page.getByRole("button", { name: "Remover logo" }).click();
    await confirm.getByRole("button", { name: "Remover logo" }).click();
    await expect(page.getByTestId("org-logo-status")).toHaveText(/Logo removida/);
    await expect(page.getByTestId("org-logo-placeholder")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("org-logo-placeholder")).toBeVisible();
    // O nome da agência continua o mesmo.
    await expect(page.locator("#s-name")).toHaveValue("Estúdio Aurora");
  });

  test("erros de envio aparecem e nada é dado como salvo", async ({ page }) => {
    await enter(page, DEMO.owner);
    await page.goto(settings);

    // Arquivo com nome de imagem, mas que não é imagem.
    await chooseLogo(page, Buffer.from("não sou uma imagem"), "falsa.png");
    await expect(page.getByTestId("org-logo-status")).toHaveText(/Não foi possível abrir a imagem/);
    await expect(page.getByRole("dialog", { name: "Ajustar logo" })).toHaveCount(0);

    // Falha no servidor: a mensagem aparece e a logo anterior é mantida.
    await page.route("**/api/org-logo", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, json: { ok: false, error: "Falha simulada no armazenamento." } })
        : route.continue(),
    );
    await chooseLogo(page, await logoPng("#2a7f62"));
    const dialog = page.getByRole("dialog", { name: "Ajustar logo" });
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Falha simulada no armazenamento.");
    await expect(dialog.getByRole("alert")).toContainText("A logo anterior foi mantida.");
    await expect(page.getByText("Logo salva")).toHaveCount(0);
    await page.unroute("**/api/org-logo");
    await dialog.getByRole("button", { name: "Cancelar" }).click();

    // O servidor valida o conteúdo real, mesmo sem a checagem do navegador.
    const res = await page.request.post("/api/org-logo", {
      multipart: {
        orgSlug: DEMO.org,
        file: { name: "falsa.png", mimeType: "image/png", buffer: Buffer.from("texto qualquer") },
      },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toMatch(/não é uma imagem válida/);
  });

  test("sem permissão ou de outra agência, não altera nem lê a logo", async ({ page }) => {
    // A dona envia uma logo para a agência de demonstração.
    await enter(page, DEMO.owner);
    const ok = await page.request.post("/api/org-logo", {
      multipart: {
        orgSlug: DEMO.org,
        file: { name: "a.png", mimeType: "image/png", buffer: await logoPng("#8e44ad") },
      },
    });
    expect(ok.status()).toBeLessThan(300);
    const { src } = (await ok.json()) as { src: string };
    const orgId = src.split("/")[3]!;
    await page.context().clearCookies();

    // Designer (sem gerenciar a agência): vê a logo, mas não altera nem remove.
    await enter(page, "marina@demo.aragonez.app");
    expect((await page.request.get(src)).status()).toBe(200);
    const denied = await page.request.post("/api/org-logo", {
      multipart: { orgSlug: DEMO.org, file: { name: "b.png", mimeType: "image/png", buffer: await logoPng("#000") } },
    });
    expect(denied.status()).toBe(403);
    expect((await page.request.delete(`/api/org-logo?org=${DEMO.org}`)).status()).toBe(403);
    await page.context().clearCookies();

    // Convidada do cliente: idem.
    await login(page, DEMO.guest, `/portal/${DEMO.org}/${DEMO.guestClient}/entrar`);
    await expect(page).toHaveURL(new RegExp(`/portal/${DEMO.org}/${DEMO.guestClient}$`), { timeout: 60_000 });
    const guestPost = await page.request.post("/api/org-logo", {
      multipart: { orgSlug: DEMO.org, file: { name: "c.png", mimeType: "image/png", buffer: await logoPng("#000") } },
    });
    expect(guestPost.status()).toBe(403);
    await page.context().clearCookies();

    // Sem sessão ou de fora da agência: 404/401, sem revelar a imagem.
    expect((await page.request.get(src)).status()).toBe(404);
    const other = await page.request.post("/api/org-logo", {
      multipart: {
        orgSlug: "agencia-que-nao-e-minha",
        file: { name: "d.png", mimeType: "image/png", buffer: await logoPng("#000") },
      },
    });
    expect(other.status()).toBe(401);
    expect((await page.request.get(`/api/org-logo/${orgId.replace(/.$/, "0")}`)).status()).toBe(404);
  });
});

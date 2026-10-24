import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { DEMO, login } from "./helpers";

/*
 * Clientes → "Importar pacote": um .zip com manifest.json cria o cliente com
 * marca, arquivos, projeto e demandas, e a tela abre o cliente criado.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function pacote(name: string) {
  const manifest = {
    format: "aragonez-client-package",
    version: 1,
    client: { name, industry: "Teste automatizado", logoBackground: "#0b0b0b" },
    brand: { colors: [{ name: "Preto", hex: "#0b0b0b" }], fonts: [{ name: "Manrope", usage: "Textos" }] },
    files: [{ path: "arquivos/logo.png", category: "brand_logo", logo: true }],
    projects: [{ name: `Projeto ${name}`, tasks: [{ title: "Post 1 — e2e" }, { title: "Post 2 — e2e" }] }],
  };
  return Buffer.from(
    zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), "arquivos/logo.png": new Uint8Array(PNG_1X1) }),
  );
}

test("importa um pacote de cliente pela tela de clientes", async ({ page }) => {
  const name = `Pacote e2e ${Date.now().toString(36)}`;
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
  await page.goto(`/w/${DEMO.org}/clients`);
  await page.getByRole("button", { name: "Importar pacote" }).click();
  const dialog = page.getByRole("dialog", { name: "Importar pacote de cliente" });
  await expect(dialog).toBeVisible();

  // Sem arquivo, o botão avisa em vez de enviar.
  await dialog.getByRole("button", { name: "Importar" }).click();
  await expect(dialog.getByText("Escolha o arquivo .zip do pacote.")).toBeVisible();

  await dialog.locator("#imp-file").setInputFiles({ name: "pacote.zip", mimeType: "application/zip", buffer: pacote(name) });
  await expect(dialog.getByText(/pacote\.zip/)).toBeVisible();
  await dialog.getByRole("button", { name: "Importar" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  const clientUrl = page.url();
  // O fundo do logotipo do pacote vale no cabeçalho do cliente.
  const headerLogo = page.locator(`span[title="${name}"]`).first();
  await expect(headerLogo).toHaveCSS("background-color", "rgb(11, 11, 11)");

  // Projeto e demandas do pacote.
  await page.goto(`${clientUrl}/projects`);
  await expect(page.getByRole("link", { name: `Projeto ${name}`, exact: true })).toBeVisible();
  await page.goto(`${clientUrl}/brand`);
  await expect(page.getByText("logo.png", { exact: true })).toBeVisible();
  await expect(page.getByText("Logotipo do cliente")).toBeVisible();

  // Trocar o fundo do logotipo em Marca muda o cabeçalho.
  const picker = page.getByTestId("logo-background");
  await expect(picker.getByRole("button", { name: "Preto" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: "Branco" }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Fundo do logotipo atualizado" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Branco" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`span[title="${name}"]`).first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

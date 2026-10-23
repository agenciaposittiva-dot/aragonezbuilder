import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { DEMO, login } from "./helpers";

/*
 * Banners extras do portal: a agência adiciona um segundo banner na
 * personalização e a prévia do início vira um carrossel com setas, pontos e
 * rolagem automática. O portal real usa o mesmo componente (coberto por
 * tests/portal-banner.test.ts na entrega das imagens).
 */

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop", "fluxo de edição só no computador");
});

const ORG = `/w/${DEMO.org}`;
const png = (color: string) =>
  sharp({ create: { width: 600, height: 200, channels: 3, background: color } })
    .png()
    .toBuffer();

async function createClient(page: Page, name: string) {
  await page.goto(`${ORG}/clients`);
  await page.getByRole("button", { name: "Novo cliente" }).first().click();
  await page.fill("#c-name", name);
  await page.getByRole("dialog").locator("button[type=submit]").click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  return page.url().split("/clients/")[1]!.split(/[/?#]/)[0]!;
}

async function upload(page: Page, selector: string, name: string, color: string) {
  const uploaded = page.waitForResponse((r) => r.url().includes("/api/uploads") && r.request().method() === "POST");
  await page.setInputFiles(selector, { name, mimeType: "image/png", buffer: await png(color) });
  expect((await uploaded).ok()).toBe(true);
}

test("dois banners viram carrossel com setas, pontos e rolagem automática", async ({ page }) => {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
  const clientId = await createClient(page, `Carrossel ${Date.now().toString(36)}`);
  await page.goto(`${ORG}/clients/${clientId}/portal`);
  await page.waitForLoadState("networkidle");

  // Banner principal + um extra com título próprio.
  await upload(page, "#pc-banner", "capa-1.png", "#0b0b0b");
  await page.fill("#pc-b-title", "Primeiro banner");
  await page.getByRole("button", { name: "Adicionar banner" }).click();
  await expect(page.getByTestId("banner-slide")).toHaveCount(1);
  await upload(page, "#pc-banner-2", "capa-2.png", "#5e8a00");
  await page.fill("#pc-bs-title-0", "Segundo banner");
  await page.locator("#pc-b-interval").fill("3");

  // Prévia do início: carrossel com 2 banners.
  const preview = page.locator("aside", { hasText: "Prévia" });
  await preview.getByRole("tab", { name: "Início" }).click();
  const banner = preview.locator('section[aria-roledescription="carrossel"]');
  await expect(banner).toHaveAttribute("data-banner-count", "2");
  await expect(banner).toHaveAttribute("data-banner-index", "0");
  await expect(banner.getByText("Primeiro banner")).toBeVisible();
  await banner.getByRole("button", { name: "Próximo banner" }).click();
  await expect(banner).toHaveAttribute("data-banner-index", "1");
  await expect(banner.getByText("Segundo banner")).toBeVisible();
  await banner.getByRole("button", { name: "Banner anterior" }).click();
  await expect(banner).toHaveAttribute("data-banner-index", "0");
  await banner.getByRole("tab", { name: "Banner 2 de 2" }).click();
  await expect(banner).toHaveAttribute("data-banner-index", "1");

  // Rolagem automática (3 s): sem o mouse sobre o banner, avança sozinho.
  await page.mouse.move(5, 5);
  await expect(banner).toHaveAttribute("data-banner-index", "0", { timeout: 8_000 });

  // No celular (prévia), as setas continuam disponíveis.
  await preview.getByRole("tab", { name: "Celular" }).click();
  const mobileBanner = preview.locator('section[aria-roledescription="carrossel"]');
  await expect(mobileBanner.getByRole("button", { name: "Próximo banner" })).toBeVisible();

  // Sem o banner extra, volta a ser um banner simples.
  await page.getByRole("button", { name: "Remover banner 2" }).click();
  await expect(page.getByTestId("banner-slide")).toHaveCount(0);
  await expect(preview.locator('section[aria-label="Banner"]')).toHaveAttribute("data-banner-count", "1");
});

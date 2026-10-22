import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Aprovação por link, sem conta: a agência envia uma peça ao cliente, cria o
 * link na página Aprovações, alguém sem conta abre o link (celular), aprova com
 * o nome, a decisão aparece no histórico da agência e o link revogado deixa de
 * funcionar. Usa um arquivo novo da Clínica Vitta (não mexe nos dados de outros testes).
 */

const ORG = `/w/${DEMO.org}`;
const tag = Date.now().toString(36);
const png = (color: string) =>
  sharp({ create: { width: 240, height: 240, channels: 3, background: color } })
    .png()
    .toBuffer();

async function uploadClientFile(page: Page, clientId: string, name: string) {
  await page.goto(`${ORG}/clients/${clientId}/files`);
  await page.getByRole("button", { name: "Enviar arquivos" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer: await png("#7a5cff") });
  const uploaded = page.waitForResponse((r) => r.url().includes("/api/uploads") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: /^Enviar/ }).click();
  expect((await uploaded).ok()).toBe(true);
  await page.waitForTimeout(500);
  if (await dialog.isVisible()) await page.keyboard.press("Escape");
  await page.reload();
  await page
    .getByRole("link", { name: new RegExp(name.replace(".png", "")) })
    .first()
    .click();
  await page.waitForURL(/\/files\/[0-9a-f-]{36}/);
  return page.url().split("/files/")[1]!.split(/[/?#]/)[0]!;
}

test("aprovação por link: criar, aprovar sem conta, histórico e revogar", async ({ page, browser }) => {
  test.skip((page.viewportSize()?.width ?? 1200) < 1024, "Fluxo da agência no computador; o link é aberto no celular abaixo.");
  test.setTimeout(240_000);
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname.startsWith("/w/"), { timeout: 60_000 });

  await page.goto(`${ORG}/clients`);
  const href = await page.getByRole("link", { name: /Clínica Vitta/ }).first().getAttribute("href");
  const clientId = href!.split("/clients/")[1]!.split(/[/?#]/)[0]!;
  const name = `peca-link-${tag}.png`;
  const fileId = await uploadClientFile(page, clientId, name);
  await page.getByRole("button", { name: "Enviar ao cliente" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Enviado para aprovação do cliente" })).toBeVisible();

  // Criar o link na página Aprovações.
  await page.goto(`${ORG}/approvals`);
  await page.getByRole("button", { name: "Criar link de aprovação" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#al-client").selectOption({ label: "Clínica Vitta" });
  await expect(dialog.getByRole("checkbox", { name })).toBeChecked();
  // Só este arquivo no link (outros pendentes do cliente ficam de fora).
  for (const box of await dialog.getByRole("checkbox").all()) {
    if ((await box.getAttribute("aria-label")) !== name && (await box.isChecked())) await box.click();
  }
  await dialog.locator("#al-label").fill(`Link ${tag}`);
  await dialog.getByRole("button", { name: "Criar link" }).click();
  const url = await dialog.getByTestId("approval-link-url").inputValue();
  expect(url).toMatch(/\/aprovar\/[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole("button", { name: "Concluir" }).click();

  // Pessoa sem conta abre no celular e aprova com o nome.
  const anon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guest = await anon.newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: `Link ${tag}` })).toBeVisible();
  const card = guest.locator(`[data-file-id="${fileId}"]`);
  await expect(card.getByText("Aguardando você")).toBeVisible();
  await expect(card.locator("img")).toBeVisible();
  await expectNoHorizontalScroll(guest);
  await card.getByRole("button", { name: "Aprovar" }).click();
  await expect(guest.locator("[data-sonner-toast]").filter({ hasText: "Informe seu nome" })).toBeVisible();
  await guest.locator("#approver-name").fill("Pessoa do Link");
  await card.getByRole("button", { name: "Aprovar" }).click();
  await expect(guest.locator("[data-sonner-toast]").filter({ hasText: "Aprovado. Obrigado!" })).toBeVisible();
  await expect(card.getByText("Aprovado", { exact: true })).toBeVisible();
  await expect(card.getByText(/por Pessoa do Link/)).toBeVisible();

  // Histórico da agência mostra quem aprovou pelo link.
  await page.goto(`${ORG}/files/${fileId}`);
  await expect(page.getByText(/Pessoa do Link/).first()).toBeVisible();

  // Revogar: o endereço deixa de funcionar.
  await page.goto(`${ORG}/approvals?tab=links`);
  const row = page.locator("tr").filter({ hasText: `Link ${tag}` });
  await expect(row.getByText("0 de 1")).toBeVisible();
  await row.getByRole("button", { name: "Revogar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revogar link" }).click();
  await expect(row.getByText("Revogado")).toBeVisible();
  await guest.reload();
  await expect(guest.getByText(/desativado pela agência/)).toBeVisible();
  await anon.close();
});

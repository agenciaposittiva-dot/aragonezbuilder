import { config } from "dotenv";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, login } from "./helpers";

/*
 * Inadimplência por cliente, contratos a vencer e o aviso diário à equipe
 * financeira. A rotina diária é disparada pelo endpoint de cron (precisa de
 * CRON_SECRET no arquivo apontado por E2E_ENV_FILE); sem ele o teste é pulado.
 */

const env = config({ path: process.env.E2E_ENV_FILE ?? ".env", processEnv: {}, quiet: true }).parsed ?? {};
const CRON_SECRET = env.CRON_SECRET ?? "";
const ORG = `/w/${DEMO.org}`;

function plusDays(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function openDemoClient(page: Page) {
  await page.goto(`${ORG}/clients`);
  await page.locator('a[href*="/clients/"]').filter({ hasText: "Café Serra Azul" }).first().click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}/);
}

async function runCron(page: Page) {
  // Primeira passada: rotinas (gera eventos). Segunda: despacha os eventos em notificações.
  for (let i = 0; i < 2; i++) {
    const res = await page.request.post("/api/cron/tick", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.ok(), await res.text()).toBe(true);
  }
}

test.describe("financeiro: inadimplência e contratos a vencer", () => {
  test.skip(!CRON_SECRET, "CRON_SECRET ausente: a rotina diária não pode ser disparada no teste.");

  test("fatura vencida vira inadimplência; contrato que termina em 10 dias aparece, filtra e avisa", async ({
    page,
  }, testInfo) => {
    const tag = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const serviceName = `Consultoria e2e ${tag}`;
    const invoiceDesc = `Fatura e2e ${tag}`;
    await login(page, DEMO.owner);
    await page.waitForURL(/\/w\//);

    // Contrato pontual que termina em 10 dias.
    await openDemoClient(page);
    await page.getByRole("button", { name: "Serviço" }).click();
    await page.fill("#sv-name", serviceName);
    await page.selectOption("#sv-billing", "one_time");
    await page.fill("#sv-amount", "1500");
    await page.fill("#sv-end", plusDays(10));
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(serviceName)).toBeVisible();

    // Fatura em aberto já vencida (a rotina diária a marca como vencida).
    await page.goto(`${ORG}/finance/invoices`);
    await page.getByRole("button", { name: "Nova fatura" }).click();
    await page.selectOption("#inv-client", { label: "Café Serra Azul" });
    await page.fill("#inv-amount", "100");
    await page.fill("#inv-desc", invoiceDesc);
    await page.fill("#inv-issue", plusDays(-10));
    await page.fill("#inv-due", plusDays(-1));
    await page.getByRole("button", { name: "Criar fatura" }).click();
    await expect(page.getByText(invoiceDesc)).toBeVisible();

    await runCron(page);

    // Visão geral: inadimplência por cliente e contratos a vencer.
    await page.goto(`${ORG}/finance`);
    await expect(page.getByRole("link", { name: /Clientes inadimplentes/ })).toContainText(/[1-9]/);
    await expect(page.getByTestId("finance-delinquent")).toContainText("Café Serra Azul");
    await expect(page.getByTestId("finance-expiring")).toContainText(serviceName);
    await expect(page.getByTestId("finance-expiring")).toContainText("em 10 dias");

    // Lista de contratos filtrada pelo término.
    await page.getByTestId("finance-expiring").getByRole("link", { name: "Ver contratos" }).click();
    await expect(page).toHaveURL(/\/finance\/contracts\?vencendo=30$/);
    const row = page.getByTestId("contract-row").filter({ hasText: serviceName });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("termina em 10 dias");

    // Dashboard: indicadores com link.
    await page.goto(ORG);
    const alerts = page.getByTestId("dashboard-alerts");
    await expect(alerts.getByRole("link", { name: /Clientes inadimplentes/ })).toContainText(/[1-9]/);
    await expect(alerts.getByRole("link", { name: /Contratos a vencer/ })).toContainText(/[1-9]/);

    // Aviso à equipe financeira.
    await page.getByRole("button", { name: /^Notificações/ }).click();
    await expect(page.getByText(`Contrato a vencer: ${serviceName} · Café Serra Azul`)).toBeVisible();
    await page.keyboard.press("Escape");

    // Limpeza: cancela a fatura e remove o serviço.
    await page.goto(`${ORG}/finance/invoices?status=overdue`);
    const invoiceRow = page.getByRole("row").filter({ hasText: invoiceDesc });
    await invoiceRow.getByRole("button", { name: /Ações da fatura/ }).click();
    await page.getByRole("menuitem", { name: "Cancelar" }).click();
    await page.getByRole("button", { name: "Cancelar fatura" }).click();
    await expect(page.getByRole("row").filter({ hasText: invoiceDesc })).toHaveCount(0);
    await openDemoClient(page);
    await page.getByRole("button", { name: `Remover ${serviceName}` }).click();
    await page.getByRole("button", { name: "Remover" }).click();
    await expect(page.getByRole("button", { name: `Remover ${serviceName}` })).toHaveCount(0);
  });
});

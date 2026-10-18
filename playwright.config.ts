import { defineConfig, devices } from "@playwright/test";

/**
 * Testes de aceitação no navegador. Pré-requisitos: banco migrado com os dados
 * de demonstração (npm run db:seed) e a aplicação rodando (npm run dev).
 * E2E_BASE_URL muda o endereço; PW_CHROMIUM aponta um Chromium já instalado.
 */
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});

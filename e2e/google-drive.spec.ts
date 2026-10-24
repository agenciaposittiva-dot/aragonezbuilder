import { config } from "dotenv";
import { expect, test } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Armazenamento e integrações (Google Drive por pessoa). Sem credenciais do
 * Google no servidor, a tela explica o que falta e não oferece a conexão; com
 * credenciais, o botão leva ao Google (o fluxo real não roda no teste).
 */

const env = config({ path: process.env.E2E_ENV_FILE ?? ".env", processEnv: {}, quiet: true }).parsed ?? {};
const CONFIGURED = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const ORG = `/w/${DEMO.org}`;

test.describe("armazenamento e integrações", () => {
  test("página pelo perfil, estado do Google Drive e aba na biblioteca", async ({ page }) => {
    await login(page, DEMO.owner);
    await page.waitForURL(/\/w\//);

    await page.goto(`${ORG}/account`);
    await page.getByTestId("account-integrations-link").click();
    await expect(page).toHaveURL(/\/account\/integrations$/);
    await expect(page.getByRole("heading", { name: "Armazenamento e integrações" })).toBeVisible();
    const card = page.getByTestId("drive-connection");
    await expect(card).toContainText("Google Drive");
    await expect(card).toContainText("Não conectado");
    if (CONFIGURED) {
      await expect(card.getByTestId("drive-connect")).toHaveAttribute(
        "href",
        /\/api\/integrations\/google-drive\/connect\?org=/,
      );
    } else {
      await expect(card.getByTestId("drive-unconfigured")).toContainText("GOOGLE_CLIENT_ID");
      await expect(card.getByTestId("drive-connect")).toBeDisabled();
    }
    await expectNoHorizontalScroll(page);

    // Biblioteca: aba Google Drive com o convite para conectar.
    await page.goto(`${ORG}/files/google-drive`);
    await expect(page.getByRole("heading", { name: "Google Drive" })).toBeVisible();
    await expect(page.getByTestId("drive-browser-empty")).toContainText(
      CONFIGURED ? "Conecte" : "não está configurado",
    );
    await expectNoHorizontalScroll(page);
  });
});

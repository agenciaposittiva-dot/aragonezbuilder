import { expect, test } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * "Minhas inteligências artificiais" (BYOK): a página existe para quem usa a
 * IA, lista os provedores sem nenhuma chave exposta, e a política da
 * organização (Configurações → Inteligência artificial) bloqueia e libera as
 * chaves pessoais. Nenhuma chave real é cadastrada (não há rede no teste).
 */

const ORG = `/w/${DEMO.org}`;

test.describe("minhas inteligências artificiais", () => {
  test("página pessoal, provedores sem segredo e política da organização bloqueia/libera", async ({ page }) => {
    await login(page, DEMO.owner);
    await page.waitForURL(/\/w\//);

    // Link no perfil.
    await page.goto(`${ORG}/account`);
    await page.getByTestId("account-ai-link").click();
    await expect(page).toHaveURL(/\/account\/ai$/);
    await expect(page.getByRole("heading", { name: "Minhas inteligências artificiais" })).toBeVisible();
    for (const provider of ["anthropic", "openai", "gemini", "magnific"]) {
      const row = page.getByTestId(`ai-connection-${provider}`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId("ai-connection-state")).toHaveText("Não configurada");
      await expect(row.getByLabel(/^Chave de API/)).toHaveValue("");
    }
    // Endereço personalizado só nos provedores compatíveis.
    await expect(page.getByTestId("ai-connection-openai").getByLabel(/^Endereço da API/)).toBeVisible();
    await expect(page.getByTestId("ai-connection-anthropic").getByLabel(/^Endereço da API/)).toHaveCount(0);
    // Chave curta demais não habilita o botão (validação só com chave plausível).
    const openai = page.getByTestId("ai-connection-openai");
    await openai.getByLabel(/^Chave de API/).fill("abc");
    await expect(openai.getByRole("button", { name: "Conectar" })).toBeDisabled();
    await expect(page.getByText("Modelo padrão por finalidade")).toBeVisible();
    await expect(page.getByText("Meu consumo este mês")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Política: a organização desliga as chaves pessoais → a página avisa e bloqueia os campos.
    await page.goto(`${ORG}/settings/ai`);
    const policySwitch = page.getByRole("switch", { name: "Permitir chaves de IA pessoais" });
    await expect(policySwitch).toHaveAttribute("aria-checked", "true");
    await policySwitch.click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Configurações de IA salvas" })).toBeVisible();

    await page.goto(`${ORG}/account/ai`);
    await expect(page.getByTestId("ai-connection-openai").getByTestId("ai-connection-policy")).toContainText(
      "não permite chaves de IA pessoais",
    );
    await expect(page.getByTestId("ai-connection-openai").getByLabel(/^Chave de API/)).toBeDisabled();

    // Libera de novo (estado original da demonstração).
    await page.goto(`${ORG}/settings/ai`);
    const again = page.getByRole("switch", { name: "Permitir chaves de IA pessoais" });
    await expect(again).toHaveAttribute("aria-checked", "false");
    await again.click();
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Configurações de IA salvas" })).toBeVisible();
    await page.goto(`${ORG}/account/ai`);
    await expect(page.getByTestId("ai-connection-openai").getByLabel(/^Chave de API/)).toBeEnabled();
  });
});

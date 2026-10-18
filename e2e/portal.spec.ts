import { expect, test } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

const portal = `/portal/${DEMO.org}/${DEMO.guestClient}`;

test.describe("portal do cliente", () => {
  test("sem sessão, o endereço do cliente leva ao login com a identidade dele", async ({ page }) => {
    await page.goto(portal);
    await expect(page).toHaveURL(new RegExp(`${portal}/entrar`));
    await expect(page.getByRole("heading", { name: "Entrar no portal" })).toBeVisible();
    await expect(page.getByText("Café Serra Azul").first()).toBeVisible();
    await expect(page.getByText("Criar conta da agência")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });

  test("senha errada mostra erro genérico, sem revelar se o e-mail existe", async ({ page }) => {
    await page.goto(`${portal}/entrar`);
    await page.fill("#email", "ninguem@exemplo.com");
    await page.fill("#password", "senha-errada-123");
    await page.click("button[type=submit]");
    await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha incorretos" })).toBeVisible();
  });

  test("convidado entra, vê só o próprio cliente e é barrado em outro", async ({ page }) => {
    await login(page, DEMO.guest, `${portal}/entrar`);
    await expect(page).toHaveURL(new RegExp(`${portal}$`));
    await expect(page.getByRole("link", { name: /Solicitar nova demanda/ })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(`/portal/${DEMO.org}/${DEMO.otherClient}`);
    await expect(page).toHaveURL(/negado=1/);
    await expect(page.getByRole("alert").filter({ hasText: "não tem acesso" })).toBeVisible();
    await expect(page.getByText("Check-up")).toHaveCount(0);
  });

  test("links antigos e de notificação abrem o portal do cliente certo", async ({ page }) => {
    await login(page, DEMO.guest, `${portal}/entrar`);
    await expect(page).toHaveURL(new RegExp(`${portal}$`));
    for (const [from, to] of [
      [`/portal/${DEMO.org}/approvals`, `${portal}/approvals`],
      [`/portal/${DEMO.org}/ir/requests`, `${portal}/requests`],
      [`/portal/${DEMO.org}`, portal],
    ]) {
      await page.goto(from);
      await expect(page).toHaveURL(new RegExp(`${to}$`));
    }
  });

  test("equipe da agência não usa o portal do cliente", async ({ page }) => {
    await login(page, DEMO.owner);
    await expect(page).toHaveURL(/\/w\//);
    await page.goto(portal);
    await expect(page).toHaveURL(new RegExp(`/w/${DEMO.org}`));
  });
});

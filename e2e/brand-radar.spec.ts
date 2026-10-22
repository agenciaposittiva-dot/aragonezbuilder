import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, inviteAndSignUp, login, removeFromDemo } from "./helpers";

/*
 * Radar de Marca de ponta a ponta, no computador e no celular. Pré-requisitos:
 * npm run db:seed e e2e/seed-trends.ts (ativa o provedor de demonstração da
 * organização). Sem META_APP_ID/META_APP_SECRET, a conexão oficial aparece
 * como "não configurada" e o fluxo usa a entrada manual com capturas de tela.
 * Capturas: E2E_SHOTS=<pasta> (opcional).
 */

const ORG = `/w/${DEMO.org}`;
const SHOTS = process.env.E2E_SHOTS;
const SCREENSHOT = path.join(__dirname, "fixtures", "foto-editor.png");

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

async function open(page: Page, url: string) {
  // A primeira visita a uma tela no servidor de desenvolvimento compila a página (pode passar de um minuto).
  await page.goto(url, { timeout: 150_000 });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function tab(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL(/tab=/);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalScroll(page);
}

async function runAi(page: Page, trigger: string, action: string) {
  await page.getByRole("button", { name: trigger }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: action }).check();
  await dialog.getByRole("button", { name: action }).click();
  await expect(page.getByText(`${action}: pronto`)).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toBeHidden();
  await page.waitForLoadState("networkidle");
}

test.describe("Radar de Marca", () => {
  test.describe.configure({ mode: "serial" });
  let profileUrl = "";
  let handle = "";

  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("começa pelo @ do cliente, aceita dados manuais e capturas e mostra fonte e data (critérios 1, 2, 3, 9, 10, 11)", async ({
    page,
  }) => {
    handle = `radar.${test.info().project.name}.${Date.now().toString(36)}`;
    await enter(page);
    await open(page, `${ORG}/brand-radar`);
    await expect(page.getByRole("heading", { name: "Radar de Marca" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "entrada");

    await page.getByRole("button", { name: "Nova análise" }).first().click();
    const create = page.getByRole("dialog");
    await create.getByLabel("Cliente").selectOption({ label: "Café Serra Azul" });
    await create.getByLabel("@ ou endereço do perfil").fill(`https://www.instagram.com/${handle}/`);
    await create.getByLabel("Nicho (opcional)").fill("Cafeteria de bairro");
    await create.getByRole("button", { name: "Adicionar e abrir" }).click();
    await page.waitForURL(/\/brand-radar\/[0-9a-f-]{36}$/);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    profileUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: `@${handle}` })).toBeVisible();
    await expect(page.getByText("Ainda sem diagnóstico")).toBeVisible();
    // Sem app da Meta no servidor: estado claro, sem pedir senha.
    await expect(page.getByTestId("instagram-connection")).toHaveAttribute("data-status", "not_configured");

    // Entrada manual com captura de tela (vai para Arquivos do cliente).
    await page.getByRole("button", { name: "Editar dados" }).click();
    const data = page.getByRole("dialog");
    await data.getByLabel("Nome de exibição").fill("Café Serra Azul");
    await data.getByLabel("Bio atual").fill("Cafés especiais na serra ☕\nPeça pelo link");
    await data.getByLabel("Link da bio").fill("https://cafe.example");
    await data.getByLabel("Seguidores (informado, não verificado)").fill("1200");
    await data.getByLabel("Destaques atuais").fill("Cardápio\nEventos");
    for (const [i, text] of ["Novo blend", "Como preparar", "Bastidores"].entries()) {
      await data.getByRole("button", { name: "Adicionar publicação" }).click();
      await data.getByLabel(`Formato da publicação ${i + 1}`).selectOption(["image", "carousel", "video"][i]!);
      await data.getByLabel(`Tema ou legenda da publicação ${i + 1}`).fill(text);
    }
    await data.getByTestId("radar-screenshot-input").setInputFiles(SCREENSHOT);
    await expect(data.getByRole("img", { name: "foto-editor.png" })).toBeVisible({ timeout: 30_000 });
    await shot(page, "dados-manuais");
    await data.getByRole("button", { name: "Salvar dados" }).click();
    await expect(page.getByText(/Dados salvos/)).toBeVisible();
    await expect(data).toBeHidden();

    // Diagnóstico com o provedor de demonstração (determinístico).
    await runAi(page, "Ações de IA", "Analisar meu perfil");
    await expect(page.getByTestId("dimensions")).toBeVisible();
    await expect(page.getByText(/modo demonstração/i).first()).toBeVisible();
    // Métricas indisponíveis não são inventadas; sem visão, a identidade visual não é avaliada.
    const visual = page.locator('[data-dimension="visual"]');
    await expect(visual).toHaveAttribute("data-status", "not_evaluated");
    await expect(visual).toContainText("demonstração não lê imagens");
    await expect(page.locator('[data-dimension="performance"]')).toHaveAttribute("data-status", "not_evaluated");
    await expect(page.locator('[data-dimension="completeness"]')).toHaveAttribute("data-status", "objective");
    await expect(page.getByTestId("evaluated-weight")).toContainText("ficou de fora");
    // Origem e data de cada dado e o que faltou.
    const sources = page.getByTestId("sources");
    await expect(sources).toContainText("Dados informados pela equipe");
    await expect(sources).toContainText("captura(s) de tela");
    await expect(sources).toContainText("não verificado");
    await expect(page.getByTestId("missing")).toContainText("Métricas reais");
    // Observado, avaliação da IA e informação insuficiente aparecem separados.
    await expect(page.locator('[data-basis="hypothesis"]').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "visao-geral");

    await tab(page, "Identidade visual");
    await expect(page.getByTestId("visual-not-evaluated")).toContainText("Não dá para avaliar");
    await tab(page, "Conteúdo");
    await expect(page.getByTestId("content-categories")).toBeVisible();
    await tab(page, "Nicho e concorrentes");
    await expect(page.getByText("não há coleta automática de outros perfis")).toBeVisible();
  });

  test("bio editável, copiável, comparável; escolha, aprovação e tarefa (critério 4)", async ({ page }) => {
    await enter(page);
    await open(page, `${profileUrl}?tab=profile`);
    const cards = page.getByTestId("bio-version");
    await expect(cards).toHaveCount(3);
    for (const c of await page.getByTestId("bio-count").allInnerTexts()) {
      const [n, limit] = c.split("/").map(Number);
      expect(n).toBeLessThanOrEqual(limit!);
    }
    await expectNoHorizontalScroll(page);

    await cards.first().getByRole("button", { name: "Copiar" }).click();
    await expect(page.getByText("Copiado")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await cards.first().getByTestId("bio-text").innerText());

    await cards.first().getByRole("button", { name: "Editar" }).click();
    await cards.first().getByLabel("Texto da bio").fill("Bio editada no teste E2E. Peça pelo link 👇");
    await expect(cards.first().getByTestId("bio-count")).toContainText("42/150");
    await cards.first().getByRole("button", { name: "Salvar versão" }).click();
    await expect(page.getByText("Nova versão salva")).toBeVisible();
    const edited = page.getByTestId("bio-version").filter({ hasText: "Bio editada no teste E2E" });
    await expect(edited).toHaveAttribute("data-style", "custom");

    await edited.getByRole("button", { name: "Comparar" }).click();
    await page.getByTestId("bio-version").nth(1).getByRole("button", { name: "Comparar" }).click();
    await expect(page.getByTestId("bio-compare")).toContainText("Bio atual");
    await shot(page, "bio-comparacao");

    await edited.getByRole("button", { name: "Usar esta versão" }).click();
    await expect(page.getByText(/o Instagram não foi alterado/).first()).toBeVisible();
    await expect(page.getByTestId("planned-bio")).toContainText("Bio editada no teste E2E");

    await edited.getByRole("button", { name: "Enviar para aprovação" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Enviar" }).click();
    await expect(page.getByText("Enviada para aprovação")).toBeVisible();
    await expect(edited.getByText("Em aprovação")).toBeVisible();

    await edited.getByRole("button", { name: "Criar tarefa de implementação" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa de implementação criada")).toBeVisible();
    await expect(edited.getByRole("link", { name: "Ver tarefa" })).toBeVisible();
  });

  test("destaques viram capa no editor e tarefa; recomendações viram tarefa (critérios 5 e 6)", async ({ page }) => {
    await enter(page);
    await open(page, `${profileUrl}?tab=highlights`);
    const plans = page.getByTestId("highlight-plan");
    await expect(plans.first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await plans.nth(1).getByRole("button", { name: "Criar tarefa" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada")).toBeVisible();
    await plans.first().getByRole("button", { name: "Criar Stories no editor" }).click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}/);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
    await shot(page, "stories-no-editor");

    await open(page, `${profileUrl}?tab=plan`);
    const rec = page.getByTestId("recommendation").first();
    await expect(rec).toBeVisible();
    await expectNoHorizontalScroll(page);
    await rec.getByRole("button", { name: "Criar tarefa" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Criar tarefa" }).click();
    await expect(page.getByText("Tarefa criada")).toBeVisible();
    await expect(rec.getByRole("link", { name: "Tarefa" })).toBeVisible();
    await rec.getByLabel("Situação").selectOption("done");
    await expect(page.getByText("Recomendação atualizada")).toBeVisible();
    await shot(page, "plano");
  });

  test("diagnósticos ficam salvos e são comparados; relatório e CSV (critério 7)", async ({ page }) => {
    await enter(page);
    await open(page, `${profileUrl}?tab=history`);
    await runAi(page, "Reavaliar depois das mudanças", "Reavaliar depois das mudanças");
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByTestId("timeline").locator(":scope > li")).toHaveCount(2);
    await page.getByRole("button", { name: "Comparar" }).click();
    await page.waitForURL(/a=.*&b=/);
    const cmp = page.getByTestId("compare-view");
    await expect(cmp).toContainText("não provam");
    await expect(cmp).toContainText("1 concluída(s)");
    await expectNoHorizontalScroll(page);
    await shot(page, "historico");

    await open(page, `${profileUrl}/report`);
    await expect(page.getByRole("heading", { name: `@${handle}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Imprimir ou salvar em PDF" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const id = profileUrl.split("/").pop();
    const csv = await page.request.get(`/api/brand-radar/export?org=${DEMO.org}&profile=${id}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain("Categoria;Área;Título");
  });

  test("respeita permissões: sem acesso ao Radar, nada aparece (critério 8)", async ({ page, browser }) => {
    test.skip(
      test.info().project.name !== "desktop",
      "Uma conta nova basta (o celular cobre o layout nos outros testes).",
    );
    const tag = Date.now().toString(36);
    const name = `Colaborador Radar ${tag}`;
    await inviteAndSignUp(page, browser, {
      email: `radar-${tag}@teste.dev`,
      name,
      password: "senha-forte-radar-123",
      role: "Colaborador",
    });
    await open(page, `${ORG}/tasks`);
    await expect(page.getByRole("link", { name: "Radar de Marca" })).toHaveCount(0);
    await page.goto(`${ORG}/brand-radar`);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    await page.goto(profileUrl);
    await expect(page.getByRole("heading", { name: "Página não encontrada" })).toBeVisible();
    const id = profileUrl.split("/").pop();
    const csv = await page.request.get(`/api/brand-radar/export?org=${DEMO.org}&profile=${id}`);
    expect(csv.status()).toBe(403);
    await removeFromDemo(browser, name);
  });

  test("os módulos existentes continuam funcionando (critério 12)", async ({ page }) => {
    test.slow();
    await enter(page);
    for (const [url, heading] of [
      [`${ORG}/trends`, "Radar de Tendências"],
      [`${ORG}/content`, "Redes sociais"],
      [`${ORG}/clients`, "Clientes"],
      [`${ORG}/studio`, "Estúdio de Carrosséis"],
    ] as const) {
      await open(page, url);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    // O item novo da navegação convive com o Radar de Tendências.
    await open(page, `${ORG}/brand-radar`);
    await expect(page.getByTestId("radar-profiles")).toContainText(`@${handle}`);
  });
});

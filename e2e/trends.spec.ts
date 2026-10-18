import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Radar de Tendências de ponta a ponta. Pré-requisitos: npm run db:seed e a
 * semente de teste (e2e/seed-trends.ts), que coleta as fontes com respostas
 * GRAVADAS e ativa o provedor de demonstração da organização.
 * Capturas: E2E_SHOTS=<pasta> (opcional).
 */

const ORG = `/w/${DEMO.org}`;
const SHOTS = process.env.E2E_SHOTS;

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

/** Abre a página e espera a hidratação; esconde o selo do next dev (cobre botões no celular). */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png`, fullPage: true });
}

test.describe("Radar de Tendências", () => {
  test("filtros por plataforma, nicho e período; salvar e descartar", async ({ page }) => {
    await enter(page);
    await open(page, `${ORG}/trends`);
    await expect(page.getByRole("heading", { name: "Radar de Tendências" })).toBeVisible();
    await expect(page.getByTestId("trends-last-update")).toContainText("Última atualização");
    await expect(page.getByTestId("trend-card").first()).toBeVisible();
    // Observado e inferido aparecem separados em cada card.
    const first = page.getByTestId("trend-card").first();
    await expect(first.getByLabel("Dados observados na fonte")).toBeVisible();
    await expect(first.getByLabel("Análise da IA (inferência)")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await shot(page, "radar");

    // Plataforma: só Wikipédia, com as contagens reais e a data dos dados.
    await page.getByLabel("Plataforma").selectOption("wikipedia");
    await page.waitForURL(/platform=wikipedia/);
    const wiki = page.getByTestId("trend-card");
    await expect(wiki).toHaveCount(3);
    await expect(wiki.filter({ hasText: "Festival de Café Fictício" })).toContainText("48.210");
    await expect(wiki.first()).toContainText("16 out de 2026");

    // Nicho + período: datas comemorativas dos próximos 60 dias.
    await open(page, `${ORG}/trends`);
    await page.getByLabel("Nicho").selectOption("datas");
    await page.waitForURL(/niche=datas/);
    await page.getByLabel("Período (7 dias)").selectOption("proximos");
    await page.waitForURL(/period=proximos/);
    const dates = page.getByTestId("trend-card");
    await expect(dates.first()).toBeVisible();
    await expect(dates.first()).toContainText("Datas comemorativas");
    await expect(dates.first()).toContainText("Sazonal");
    await shot(page, "radar-datas");

    // Salvar → aparece em Salvas; desfazer deixa como estava.
    await open(page, `${ORG}/trends?platform=google_trends`);
    const target = page.getByTestId("trend-card").filter({ hasText: "Lançamento do Aplicativo Exemplo" });
    await target.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(target.getByRole("button", { name: "Salva (desfazer)" })).toBeVisible();
    await open(page, `${ORG}/trends?tab=saved`);
    const saved = page.getByTestId("trend-card").filter({ hasText: "Lançamento do Aplicativo Exemplo" });
    await expect(saved).toHaveCount(1);
    await saved.getByRole("button", { name: "Salva (desfazer)" }).click();
    await expect(page.getByTestId("trend-card").filter({ hasText: "Lançamento do Aplicativo Exemplo" })).toHaveCount(0);

    // Descartar → some de Todas e vai para Descartadas.
    await open(page, `${ORG}/trends?platform=google_trends`);
    const gone = page.getByTestId("trend-card").filter({ hasText: "Clássico Regional Exemplo" });
    await gone.getByRole("button", { name: "Descartar" }).click();
    await expect(page.getByTestId("trend-card").filter({ hasText: "Clássico Regional Exemplo" })).toHaveCount(0);
    await open(page, `${ORG}/trends?tab=dismissed`);
    const dismissed = page.getByTestId("trend-card").filter({ hasText: "Clássico Regional Exemplo" });
    await expect(dismissed).toHaveCount(1);
    await dismissed.getByRole("button", { name: "Descartada (desfazer)" }).click();
    await expect(page.getByTestId("trend-card").filter({ hasText: "Clássico Regional Exemplo" })).toHaveCount(0);
  });

  test("pergunta por cliente e Criar conteúdo até arte, tarefa e calendário", async ({ page }) => {
    const tag = `${test.info().project.name}-${Date.now().toString(36)}`;
    await enter(page);
    await open(page, `${ORG}/trends`);

    await page.getByLabel("Cliente", { exact: true }).selectOption({ label: "Café Serra Azul" });
    await page.getByRole("button", { name: "Perguntar" }).click();
    const result = page.getByTestId("client-fit-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toContainText("Café Serra Azul");
    await expect(result).toContainText("Demonstração");
    await expect(result.getByText("Não recomendadas para esta marca")).toBeVisible();
    await shot(page, "pergunta-cliente");

    // Criar conteúdo a partir de uma recomendada (o cliente já vem escolhido).
    await result.getByRole("link", { name: "Criar conteúdo" }).first().click();
    await page.waitForURL(/\/trends\/[0-9a-f-]{36}\?create=1/);
    await page.waitForLoadState("networkidle");
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("combobox", { name: "Cliente", exact: true })).toHaveValue(/[0-9a-f-]{36}/);
    await dialog.getByRole("checkbox", { name: /Stories/ }).click();
    await dialog.getByRole("button", { name: "Gerar prévia com IA" }).click();
    await expect(dialog.getByRole("textbox", { name: "Título", exact: true })).not.toHaveValue("", { timeout: 30_000 });
    await expect(dialog).toContainText("Textos sugeridos pela IA");
    await dialog.getByRole("textbox", { name: "Título", exact: true }).fill(`Conteúdo E2E ${tag}`);
    await dialog.getByRole("combobox", { name: "Campanha", exact: true }).selectOption("new");
    await dialog.getByLabel("Nome da nova campanha").fill(`Campanha ${tag}`);
    await dialog.getByRole("combobox", { name: "Projeto", exact: true }).selectOption("new");
    await dialog.getByLabel("Nome do novo projeto").fill(`Projeto ${tag}`);
    const planned = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await dialog.getByLabel("Data planejada (calendário editorial)").fill(planned);
    await dialog.getByRole("checkbox", { name: "Criar tarefa de produção" }).click();
    const summary = dialog.getByTestId("create-summary");
    await expect(summary).toContainText("2 peça(s)");
    await expect(summary).toContainText("2 arte(s) editável(is)");
    await expect(summary).toContainText("1 tarefa de produção");
    await shot(page, "criar-conteudo-previa");
    await dialog.getByRole("button", { name: "Confirmar e criar" }).click();
    const done = dialog.getByTestId("create-done");
    await expect(done).toContainText("Criado com sucesso", { timeout: 30_000 });
    await shot(page, "criar-conteudo-pronto");

    // Arte aberta no editor atual.
    const taskHref = await done.getByRole("link", { name: "Ver tarefa" }).getAttribute("href");
    await done
      .getByRole("link", { name: /Abrir arte/ })
      .first()
      .click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}/);
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 30_000 });

    // Tarefa criada no projeto novo.
    expect(taskHref).toMatch(/\/tasks\/[0-9a-f-]{36}/);
    await open(page, taskHref!);
    await expect(page.getByText(`Produzir: Conteúdo E2E ${tag}`).first()).toBeVisible();

    // Calendário editorial do mês da data planejada.
    await open(page, `${ORG}/content?view=calendar&month=${planned.slice(0, 7)}`);
    await expect(page.getByText(`Conteúdo E2E ${tag}`).first()).toBeAttached();
    await expectNoHorizontalScroll(page);
    await shot(page, "calendario");
    await open(page, `${ORG}/content?view=week&week=${planned}`);
    await expect(page.getByText(`Conteúdo E2E ${tag}`).first()).toBeVisible();

    // Peça com vínculos (tendência, campanha, projeto, tarefa) e artes.
    await page.getByText(`Conteúdo E2E ${tag}`).first().click();
    await page.waitForURL(/\/content\/[0-9a-f-]{36}/);
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Vínculos")).toContainText(`Campanha ${tag}`);
    await expect(page.getByLabel("Vínculos")).toContainText(`Projeto ${tag}`);
    await expect(page.getByLabel("Artes")).toContainText("Abrir no editor");
    await shot(page, "peca");
  });

  test("fontes: estado real e Testar agora", async ({ page }) => {
    await enter(page);
    await open(page, `${ORG}/trends/sources`);
    const sources = page.getByTestId("trend-source");
    await expect(sources).toHaveCount(4);
    await expect(sources.filter({ hasText: "YouTube" })).toContainText("YOUTUBE_API_KEY");
    await expect(sources.filter({ hasText: "Google Trends" })).toContainText("Termos de uso");
    await expect(sources.filter({ hasText: "Wikipédia" })).toContainText("atraso de cerca de 1 dia");
    // Resultado real da tentativa (neste ambiente os hosts não respondem): o aviso cita a fonte e o
    // estado na tela passa a refletir a última tentativa, sem inventar sucesso.
    await sources.filter({ hasText: "Google Trends" }).getByRole("button", { name: "Testar agora" }).click();
    await expect(
      page
        .locator("[data-sonner-toast]")
        .filter({ hasText: /Google Trends — Brasil:|fonte\(s\) atualizada/ })
        .first(),
    ).toBeVisible();
    await expect(sources.filter({ hasText: "Google Trends" }).getByTestId("source-status")).toContainText(
      /Funcionando|Erro na última tentativa/,
    );
    await expectNoHorizontalScroll(page);
    await shot(page, "fontes");
  });
});

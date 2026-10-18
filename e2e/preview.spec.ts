import { expect, test, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Central de pré-visualização de ponta a ponta. Pré-requisitos: npm run db:seed
 * e a semente e2e/seed-preview.ts (peças "Prévia e2e" com artes salvas).
 * Os passos que mudam dados (edição da arte, pedidos e decisões de aprovação)
 * rodam só no projeto de computador, para o celular ver a mesma semente.
 */

const ORG = `/w/${DEMO.org}`;
const PORTAL = `/portal/${DEMO.org}/${DEMO.guestClient}`;

async function enter(page: Page, email = DEMO.owner) {
  await login(page, email);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

/** Abre a prévia de uma peça da semente pela lista de conteúdos (ação "Visualizar publicação"). */
async function openPreview(page: Page, title: string) {
  await open(page, `${ORG}/content?q=${encodeURIComponent(title)}`);
  await page.getByRole("link", { name: `Visualizar publicação: ${title}` }).click();
  await page.waitForURL(/\/content\/[0-9a-f-]{36}\/preview$/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await expect(page.getByTestId("preview-stage")).toBeVisible();
}

/** A página atual já foi desenhada a partir da arte salva (imagem pronta, não o esqueleto). */
async function expectRendered(page: Page) {
  await expect(
    page.locator("[data-testid=preview-current-media] img, img[data-testid=preview-current-media]").first(),
  ).toHaveAttribute("src", /^(blob:|\/api\/files\/)/, { timeout: 30_000 });
}

const checks = (page: Page) => page.getByTestId("preview-checks");
const isDesktop = () => test.info().project.name === "desktop";

test.describe("Central de pré-visualização", () => {
  test("post de feed: simulação, legenda salva e verificador de margens e proporção", async ({ page }) => {
    await enter(page);
    await openPreview(page, "Prévia e2e — Post de feed");
    await expect(page.getByTestId("preview-post")).toBeVisible();
    await expectRendered(page);
    await expect(page.getByText("Interface ilustrativa · sem curtidas ou comentários reais")).toBeVisible();

    // Legenda da peça, cortada em "mais" como na rede.
    const caption = page.getByTestId("preview-caption");
    await expect(caption).toContainText("Da serra para a sua xícara");
    await caption.getByRole("button", { name: "mais" }).click();
    await expect(caption).toContainText("#cafeespecial #torrafresca");
    await expect(caption).toContainText("Peça pela loja online");

    // Verificador: texto colado na borda; separado da validação oficial da rede.
    await expect(checks(page).locator("[data-code=near_edge]")).toBeVisible();
    await expect(checks(page)).toContainText("não significa aprovação da rede social");
    // Arte 4:5 escolhida como feed quadrado: a rede vai cortar.
    await page.getByLabel("Formato").selectOption("feed_square");
    await expect(checks(page).locator("[data-code=ratio]")).toBeVisible();
    await page.getByLabel("Formato").selectOption("feed_portrait");
    await expect(checks(page).locator("[data-code=ratio]")).toHaveCount(0);

    // A legenda editada na prévia é a que fica salva na peça.
    const novo = `Legenda revisada ${Date.now()}`;
    await page.getByRole("tab", { name: "Legenda" }).click();
    const original = await page.getByRole("textbox", { name: "Legenda" }).inputValue();
    await page.getByRole("textbox", { name: "Legenda" }).fill(novo);
    await expect(caption).toContainText(novo);
    await page.getByRole("button", { name: "Salvar legenda" }).click();
    await expect(page.getByText("Legenda salva")).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("preview-caption")).toContainText(novo);
    await expectNoHorizontalScroll(page);
    // Desfaz a troca para a peça voltar como estava (o outro projeto usa a mesma semente).
    await page.getByRole("tab", { name: "Legenda" }).click();
    await page.getByRole("textbox", { name: "Legenda" }).fill(original);
    await page.getByRole("button", { name: "Salvar legenda" }).click();
    await expect(page.getByText("Legenda salva")).toBeVisible();
  });

  test("carrossel: todas as páginas, miniaturas, composição contínua, exportação e volta ao editor", async ({
    page,
  }) => {
    await enter(page);
    await openPreview(page, "Prévia e2e — Carrossel");
    await expectRendered(page);
    const stage = page.getByTestId("preview-stage");
    await expect(stage.getByText("1/4")).toBeVisible();
    for (const n of [2, 3, 4]) {
      await stage.getByRole("button", { name: "Próxima página" }).click();
      await expect(stage.getByText(`${n}/4`)).toBeVisible();
    }
    await expect(page.getByRole("list", { name: "Miniaturas" }).getByRole("listitem")).toHaveCount(4);

    // Texto cortado na 3ª página: o aviso leva à página e marca a camada.
    const cut = checks(page).locator("[data-code=text_cut]");
    await expect(cut).toContainText("Página 3");
    await cut.getByRole("button", { name: "Mostrar na prévia" }).click();
    await expect(stage.getByText("3/4")).toBeVisible();
    await expect(page.getByTestId("preview-highlight")).toBeVisible();

    await page.getByRole("radio", { name: "Composição contínua" }).click();
    await expect(page.getByTestId("preview-strip").getByRole("button")).toHaveCount(4);
    await expectNoHorizontalScroll(page);

    // Exporta as 4 páginas em ordem (desenhadas a partir da arte salva).
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exportar" }).click();
    await page.getByRole("menuitem", { name: /Todas as páginas/ }).click();
    expect((await download).suggestedFilename()).toMatch(/\.zip$/);

    if (isDesktop()) {
      // Aprovação pelo fluxo existente: um pedido por página exportada.
      await page.getByRole("tab", { name: "Aprovação" }).click();
      await page.getByRole("button", { name: "Pedir revisão interna" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("1 erro(s)");
      await dialog.getByRole("button", { name: "Enviar" }).click();
      await expect(page.getByText("4 página(s) enviada(s) para revisão interna")).toBeVisible();
      await expect(page.getByTestId("preview-approvals").getByText("Pendente")).toHaveCount(4);
    }

    // "Corrigir no editor" abre a arte na página e na camada do aviso.
    await page.getByRole("tab", { name: "Verificação" }).click();
    await checks(page).locator("[data-code=text_cut]").getByRole("link", { name: "Corrigir no editor" }).click();
    await page.waitForURL(/\/studio\/[0-9a-f-]{36}\?pagina=.+&objeto=slide3/, { timeout: 60_000 });
    await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __designEditor: { store: { selection: string[] } } }).__designEditor.store
              .selection,
        ),
      )
      .toEqual(["slide3"]);
  });

  test("Stories: sequência na moldura do celular, controles e edição refletida na prévia", async ({ page }) => {
    await enter(page);
    await openPreview(page, "Prévia e2e — Stories");
    const player = page.getByTestId("stories-player");
    await expect(player).toBeVisible();
    const controls = page.getByRole("group", { name: "Controles da sequência" });
    await controls.getByRole("button", { name: "Pausar" }).click();
    await expect(controls).toContainText("1 de 3");
    await controls.getByRole("button", { name: "Próxima tela" }).click();
    await expect(controls).toContainText("2 de 3");
    await controls.getByRole("button", { name: "Reiniciar sequência" }).click();
    await expect(controls).toContainText("1 de 3");
    await page.getByRole("button", { name: "Áreas seguras" }).click();
    await expect(page.getByTestId("safe-area-overlay").first()).toBeVisible();
    await expect(page.getByText("Enquetes, links e caixas de perguntas não fazem parte da arte")).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (!isDesktop()) return;

    // Texto no topo da 1ª tela: corrige no editor e a prévia mostra o novo salvamento.
    const unsafe = checks(page).locator("[data-code=unsafe_area]");
    await expect(unsafe).toBeVisible();
    await unsafe.getByRole("link", { name: "Corrigir no editor" }).click();
    await expect(page.locator("[data-editor-ready=true]")).toBeVisible({ timeout: 60_000 });
    const savedAt = (await page.locator("[data-save-state]").first().getAttribute("data-saved-at")) ?? "";
    await page.evaluate(() =>
      (
        window as unknown as { __designEditor: { store: { dispatch: (ops: unknown[]) => void } } }
      ).__designEditor.store.dispatch([{ op: "transform", id: "story1", y: 800 }]),
    );
    await expect
      .poll(async () => (await page.locator("[data-save-state]").first().getAttribute("data-saved-at")) ?? "", {
        timeout: 30_000,
      })
      .not.toBe(savedAt);
    await page.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitem", { name: "Visualizar publicação" }).click();
    await page.waitForURL(/\/content\/[0-9a-f-]{36}\/preview$/, { timeout: 60_000 });
    await expect(page.getByTestId("stories-player")).toBeVisible();
    await expect(checks(page).locator("[data-code=unsafe_area]")).toHaveCount(0);
  });

  test("portal: o cliente vê a prévia do que foi enviado e decide pelo fluxo de aprovação", async ({ page }) => {
    await enter(page, DEMO.guest);
    await open(page, `${PORTAL}/files`);
    await page
      .getByRole("link", { name: /Prévia e2e para o cliente/ })
      .first()
      .click();
    await page.waitForURL(/\/files\/[0-9a-f-]{36}/, { timeout: 60_000 });
    await page.getByRole("link", { name: "Visualizar publicação" }).click();
    await page.waitForURL(/\/preview\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    const contentId = page.url().split("/").at(-1)!;
    await expect(page.getByTestId("preview-caption")).toContainText("O lote de outono chegou");
    await expectRendered(page);
    await expectNoHorizontalScroll(page);
    if (isDesktop()) {
      await page.getByRole("button", { name: /^Aprovar/ }).click();
      await expect(page.getByText("Aprovado").first()).toBeVisible();
    }

    // Isolamento: outro cliente e a prévia interna da agência ficam fechados para o cliente.
    await page.goto(`/portal/${DEMO.org}/${DEMO.otherClient}/preview/${contentId}`);
    await expect(page).not.toHaveURL(new RegExp(`${DEMO.otherClient}/preview`));
    const internal = await page.goto(`${ORG}/content/${contentId}/preview`);
    expect(page.url()).not.toContain("/content/");
    expect(internal?.status() ?? 200).toBeLessThan(500);
  });
});

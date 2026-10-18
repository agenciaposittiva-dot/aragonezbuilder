import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEMO, expectNoHorizontalScroll, login } from "./helpers";

/*
 * Central de Tarefas: criação rápida, edição inline, quadro, calendário,
 * subtarefas, menções, etiquetas, modelos, assistente de IA (modo
 * demonstração habilitado pela organização) e lixeira. Cada teste cria os
 * próprios registros (títulos únicos) na agência de demonstração.
 */

const ORG = `/w/${DEMO.org}`;
const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1200) < 768;

function isoDate(offset = 0) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function enter(page: Page) {
  await login(page, DEMO.owner);
  await page.waitForURL((u) => u.pathname === "/" || u.pathname.startsWith("/w/"), { timeout: 60_000 });
}

/** Cria pela "Nova tarefa" e abre a página da tarefa (sem o painel lateral). */
async function newTask(page: Page, title: string, opts: { due?: string } = {}) {
  await page.goto(`${ORG}/tasks?view=list`);
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#t-title").fill(title);
  await dialog.locator("#t-project").selectOption({ index: 1 });
  if (opts.due) await dialog.locator("#t-due").fill(opts.due);
  await dialog.getByRole("button", { name: "Criar" }).click();
  await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const id = page.url().split("/tasks/")[1]!.split(/[/?#]/)[0]!;
  await page.goto(`${ORG}/tasks/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return id;
}

/** Resposta da próxima Server Action (gravação no servidor). */
function actionResponse(page: Page) {
  return page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
}

/** Arrasta com o mouse (o dnd-kit só ativa depois de alguns pixels). */
async function drag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 });
  const b = (await to.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 80), { steps: 20 });
  await page.mouse.up();
}

test.describe("central de tarefas", () => {
  test.beforeEach(async ({ page }) => {
    await enter(page);
  });

  test("criação rápida no quadro e edição inline do título", async ({ page }, info) => {
    const title = `E2E rápida ${Date.now().toString(36)} ${info.project.name}`;
    await page.goto(`${ORG}/tasks?view=board`);
    const column = page.locator('section[aria-label="A fazer"]');
    await column.getByRole("button", { name: "Adicionar tarefa" }).click();
    await column.getByLabel("Título da nova tarefa").fill(title);
    await column.getByLabel("Título da nova tarefa").press("Enter");
    await expect(column.getByText(title)).toBeVisible();
    await expectNoHorizontalScroll(page);

    const href = await column.getByRole("link", { name: title }).first().getAttribute("href");
    await page.goto(href!);
    await page.getByRole("heading", { level: 1, name: title }).click();
    const input = page.getByLabel("Título da tarefa");
    await input.fill(`${title} editada`);
    await input.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: `${title} editada` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `${title} editada` })).toBeVisible();
  });

  test("quadro: arrastar o cartão muda o status", async ({ page }, info) => {
    const title = `E2E quadro ${Date.now().toString(36)} ${info.project.name}`;
    await newTask(page, title);
    await page.goto(`${ORG}/tasks?view=board&q=${encodeURIComponent(title)}`);
    await page.waitForLoadState("networkidle");
    const card = page.locator('[aria-roledescription="sortable"]').filter({ hasText: title });
    await expect(page.locator('section[aria-label="A fazer"]').getByText(title)).toBeVisible();
    if (isMobile(page)) {
      // No celular as colunas rolam na horizontal: usa o teclado do dnd-kit.
      await card.focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(300);
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      await expect(page.locator('section[aria-label="Em produção"]').getByText(title)).toBeVisible();
      const saved = actionResponse(page);
      await page.keyboard.press("Space");
      await saved;
    } else {
      const saved = actionResponse(page);
      await drag(page, card, page.locator('section[aria-label="Em produção"]'));
      await saved;
    }
    await page.reload();
    await expect(page.locator('section[aria-label="Em produção"]').getByText(title)).toBeVisible();
  });

  test("calendário: mudar o prazo arrastando (ou pelo seletor de data no celular)", async ({ page }, info) => {
    const title = `E2E agenda ${Date.now().toString(36)} ${info.project.name}`;
    const due = isoDate(0);
    const weekday = new Date(`${due}T12:00:00Z`).getUTCDay();
    const target = isoDate(weekday === 6 ? -1 : 1); // mesmo semana
    await newTask(page, title, { due });
    const q = encodeURIComponent(title);
    if (isMobile(page)) {
      await page.goto(`${ORG}/tasks?view=calendar&cal=day&date=${due}&q=${q}`);
      await page.waitForLoadState("networkidle");
      const saved = actionResponse(page);
      const input = page.getByLabel(`Prazo de ${title}`);
      // Repete se a página ainda não estava hidratada: a tarefa sai do dia assim que o novo prazo é aceito.
      await expect(async () => {
        if (await input.count()) await input.fill(target, { timeout: 3_000 });
        await expect(page.getByRole("link", { name: title })).toHaveCount(0, { timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await saved;
      await page.goto(`${ORG}/tasks?view=calendar&cal=day&date=${target}&q=${q}`);
      await expect(page.getByRole("link", { name: title })).toBeVisible();
    } else {
      await page.goto(`${ORG}/tasks?view=calendar&cal=week&date=${due}&q=${q}`);
      const chip = page.locator(`[data-date="${due}"]`).getByRole("link", { name: title });
      await expect(chip).toBeVisible();
      const saved = actionResponse(page);
      await drag(page, chip, page.locator(`[data-date="${target}"]`));
      await expect(page.locator(`[data-date="${target}"]`).getByText(title)).toBeVisible();
      await saved;
      await page.reload();
      await expect(page.locator(`[data-date="${target}"]`).getByText(title)).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
  });

  test("subtarefas, menção nos comentários e etiqueta", async ({ page }, info) => {
    const tag = `${Date.now().toString(36)}${info.project.name.slice(0, 1)}`;
    const title = `E2E colaboração ${tag}`;
    await newTask(page, title);

    await page.getByLabel("Nova subtarefa").fill(`Rascunho ${tag}`);
    await page.getByLabel("Nova subtarefa").press("Enter");
    await expect(page.getByRole("link", { name: `Rascunho ${tag}` })).toBeVisible();

    const box = page.getByLabel("Novo comentário");
    await box.click();
    await box.pressSequentially("Pode revisar, @");
    const options = page.getByRole("listbox", { name: "Mencionar" });
    await expect(options).toBeVisible();
    // O texto da opção começa pelas iniciais do avatar; o nome é a última linha.
    const name = (await options.getByRole("option").first().innerText()).trim().split("\n").pop()!.trim();
    await options.getByRole("option").first().click();
    await expect(box).toHaveValue(new RegExp(`@${name}`));
    await page.getByRole("button", { name: "Comentar" }).click();
    await expect(page.getByText(`@${name}`).first()).toBeVisible();

    const label = `E2E ${tag}`;
    await page.getByRole("button", { name: "Etiquetas" }).click();
    await page.getByLabel("Buscar etiqueta").fill(label);
    await page.getByRole("button", { name: `Criar “${label}”` }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Etiquetas" })).toContainText(label);
    await page.reload();
    await expect(page.getByRole("button", { name: "Etiquetas" })).toContainText(label);
    await expect(page.getByRole("link", { name: `Rascunho ${tag}` })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("modelo de tarefa: criar com etapas e aplicar a um projeto", async ({ page }, info) => {
    const tag = `${Date.now().toString(36)} ${info.project.name}`;
    const name = `E2E modelo ${tag}`;
    await page.goto(`${ORG}/task-templates`);
    await page.getByRole("button", { name: "Novo modelo" }).click();
    const editor = page.getByRole("dialog");
    await editor.locator("#tpl-name").fill(name);
    await editor.getByRole("button", { name: "Etapa", exact: true }).click();
    await editor.getByLabel("Nome da etapa 1").fill("Briefing");
    await editor.getByLabel("Prazo da etapa 1 em dias").fill("1");
    await editor.getByRole("button", { name: "Etapa", exact: true }).click();
    await editor.getByLabel("Nome da etapa 2").fill("Produção");
    await editor.getByLabel("Prazo da etapa 2 em dias").fill("4");
    await editor.getByRole("button", { name: "Salvar modelo" }).click();
    await expect(toast(page, "Modelo criado")).toBeVisible();

    const card = page.locator("li").filter({ hasText: name });
    await expect(card).toContainText("Briefing");
    await expectNoHorizontalScroll(page);
    await card.getByRole("button", { name: "Usar modelo" }).click();
    const apply = page.getByRole("dialog");
    await apply.locator("#apply-project").selectOption({ index: 1 });
    await apply.locator("#apply-title").fill(`E2E do modelo ${tag}`);
    await apply.getByRole("button", { name: "Criar tarefas" }).click();
    await page.waitForURL(/\/tasks\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: `E2E do modelo ${tag}` })).toBeVisible();
    await expect(page.getByText("Briefing").first()).toBeVisible();
    await expect(page.getByText("Produção").first()).toBeVisible();
  });

  test("assistente de IA: prévia editável e criação só após confirmar", async ({ page, context }, info) => {
    // A organização habilita o modo demonstração (local) e o estado anterior é restaurado no fim.
    await page.goto(`${ORG}/settings/ai`);
    const demo = page.getByRole("switch", { name: /Habilitar Demonstração/ });
    const wasOn = (await demo.getAttribute("aria-checked")) === "true";
    if (!wasOn) {
      await demo.click();
      await expect(demo).toHaveAttribute("aria-checked", "true");
    }
    try {
      const tag = `${Date.now().toString(36)}${info.project.name.slice(0, 1)}`;
      await page.goto(`${ORG}/tasks?view=list`);
      await page.getByRole("button", { name: "Assistente" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("O que precisa ser feito?").fill(`- Post IA ${tag}\n- Stories IA ${tag}`);
      await dialog.getByRole("button", { name: "Gerar proposta" }).click();
      await expect(dialog.getByText("Revise e ajuste antes de criar")).toBeVisible();
      await expect(dialog.getByLabel("Título da tarefa 1")).toHaveValue(`Post IA ${tag}`);
      await dialog.getByLabel("Título da tarefa 2").fill(`Stories IA ${tag} editado`);

      // Nada foi criado ainda.
      const other = await context.newPage();
      await other.goto(`${ORG}/tasks?view=list&q=${encodeURIComponent(`IA ${tag}`)}`);
      await expect(other.getByText(`Post IA ${tag}`)).toHaveCount(0);

      await dialog.locator("#ai-plan-project").selectOption({ index: 1 });
      await dialog.getByRole("button", { name: "Revisar e criar 2 tarefas" }).click();
      await expect(dialog.getByRole("alert")).toContainText("Serão criadas 2 tarefas");
      await dialog.getByRole("button", { name: "Confirmar criação" }).click();
      await expect(toast(page, "2 tarefas criadas")).toBeVisible();

      await other.reload();
      await expect(other.getByText(`Post IA ${tag}`).first()).toBeVisible();
      await expect(other.getByText(`Stories IA ${tag} editado`).first()).toBeVisible();
      await expectNoHorizontalScroll(other);
      await other.close();
    } finally {
      if (!wasOn) {
        await page.goto(`${ORG}/settings/ai`);
        await page.getByRole("switch", { name: /Habilitar Demonstração/ }).click();
        await expect(page.getByRole("switch", { name: /Habilitar Demonstração/ })).toHaveAttribute(
          "aria-checked",
          "false",
        );
      }
    }
  });

  test("lixeira: excluir a tarefa tira das listas e restaurar devolve", async ({ page }, info) => {
    const title = `E2E lixeira ${Date.now().toString(36)} ${info.project.name}`;
    await newTask(page, title);
    await page.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitem", { name: "Excluir tarefa" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Mover para a lixeira" }).click();
    await expect(toast(page, "movida para a lixeira")).toBeVisible();

    const list = `${ORG}/tasks?view=list&q=${encodeURIComponent(title)}`;
    await page.goto(list);
    await expect(page.getByText(title)).toHaveCount(0);

    await page.goto(`${ORG}/trash`);
    const row = page.locator("li").filter({ hasText: title });
    await expect(row).toContainText("Tarefa");
    await expectNoHorizontalScroll(page);
    await row.getByRole("button", { name: "Restaurar" }).click();
    await expect(toast(page, /restaurad/)).toBeVisible();
    await page.goto(list);
    await expect(page.getByText(title).first()).toBeVisible();
  });
});

/**
 * SEMENTE DE TESTE da Central de pré-visualização (só para os testes de ponta a ponta).
 *
 * Cria, na agência de demonstração, peças com artes salvas no editor:
 *  - post de feed com um texto colado na borda (aviso de margem);
 *  - carrossel de 4 páginas exportadas para Arquivos, com um texto cortado na 3ª;
 *  - sequência de Stories com um texto no topo (área coberta pela interface);
 *  - post já aprovado internamente e enviado ao cliente (aparece no portal).
 * Antes, apaga só o que esta semente criou (títulos "Prévia e2e"). Nunca roda
 * em produção nem em banco remoto.
 *
 * Uso: ENV_FILE=.env.local npx tsx --tsconfig tsconfig.node.json e2e/seed-preview.ts
 *      (depois de npm run db:seed)
 */
import "../src/worker/load-env";
import { and, eq, isNull, like } from "drizzle-orm";
import sharp from "sharp";
import { createDocument, rectObject, textObject, type DesignDocument } from "@/lib/design-doc";
import { inOrg, type Scope } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { pool, withSystem } from "@/server/db";
import { clients, contentItemAssets, contentItems, designs, files, organizations, user } from "@/server/db/schema";
import { decideApproval, requestApproval } from "@/server/services/approvals";
import { createContent } from "@/server/services/content";
import { createDesign } from "@/server/services/designs";
import { storeUpload } from "@/server/services/files";

if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
  console.error("Recusado: semente de teste não roda em produção.");
  process.exit(1);
}
const db = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(db)) {
  console.error("Recusado: a semente de teste só roda em banco local.");
  process.exit(1);
}

const ORG_SLUG = "estudio-aurora";
const OWNER = "helena@demo.aragonez.app";
const PREFIX = "Prévia e2e";

const NAVY = "#1F3A5F";
const CREAM = "#F3E9DC";

/** Imagem exportada de uma página (como a exportação do editor), com o número da página. */
function pagePng(label: string, w: number, h: number, bg: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" font-size="${Math.round(w / 9)}" text-anchor="middle" fill="#ffffff" font-family="sans-serif">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const page = (w: number, h: number, name: string, objects: DesignDocument["pages"][number]["objects"], bg = CREAM) => ({
  width: w,
  height: h,
  name,
  background: bg,
  objects,
});

async function link(s: Scope, contentId: string, designId: string, role: string) {
  await s.db
    .insert(contentItemAssets)
    .values({ organizationId: s.actor.orgId, contentItemId: contentId, designId, role, position: 0 });
}

/** Exporta as páginas para Arquivos e grava onde cada uma foi parar (meta.outputs), como o editor faz. */
async function exportPages(s: Scope, designId: string, clientId: string, doc: DesignDocument, base: string) {
  const outputs: Record<string, string> = {};
  for (const [i, p] of doc.pages.entries()) {
    const f = await storeUpload(
      s,
      {
        buffer: await pagePng(`${i + 1}`, p.width, p.height, i % 2 ? "#C08552" : NAVY),
        originalName: `${base} - ${String(i + 1).padStart(2, "0")}.png`,
      },
      { clientId },
    );
    outputs[p.id] = f.fileId;
  }
  const [d] = await s.db.select({ document: designs.document }).from(designs).where(eq(designs.id, designId));
  const document = { ...(d!.document as Record<string, unknown>) } as { meta?: Record<string, unknown> };
  document.meta = { ...document.meta, outputs };
  await s.db.update(designs).set({ document, outputFileId: outputs[doc.pages[0]!.id] }).where(eq(designs.id, designId));
  return Object.values(outputs);
}

async function main() {
  const [org] = await withSystem((tx) => tx.select().from(organizations).where(eq(organizations.slug, ORG_SLUG)));
  if (!org) throw new Error(`Rode antes "npm run db:seed" (organização ${ORG_SLUG} não encontrada).`);
  const [owner] = await withSystem((tx) => tx.select().from(user).where(eq(user.email, OWNER)));
  const actor = owner ? await resolveActor(owner.id, ORG_SLUG) : null;
  if (!actor) throw new Error("Conta proprietária da demonstração não encontrada.");

  // Só o que esta semente criou.
  await withSystem(async (tx) => {
    await tx
      .delete(contentItems)
      .where(and(eq(contentItems.organizationId, org.id), like(contentItems.title, `${PREFIX}%`)));
    await tx.delete(designs).where(and(eq(designs.organizationId, org.id), like(designs.name, `${PREFIX}%`)));
    // Arquivos exportados nas rodadas anteriores vão para a lixeira (somem das listas e aprovações).
    await tx
      .update(files)
      .set({ deletedAt: new Date() })
      .where(and(eq(files.organizationId, org.id), like(files.name, `${PREFIX}%`), isNull(files.deletedAt)));
  });

  await inOrg(actor, async (s) => {
    const [cafe] = await s.db.select().from(clients).where(eq(clients.name, "Café Serra Azul"));
    if (!cafe) throw new Error("Cliente Café Serra Azul não encontrado.");

    /* Post de feed ---------------------------------------------------------- */
    const feedDoc = createDocument({
      pages: [
        page(1080, 1350, "Página 1", [
          rectObject({ id: "faixa", name: "Faixa", x: 0, y: 900, width: 1080, height: 450, fill: NAVY }),
          textObject({
            id: "titulo",
            text: "Torra fresca toda semana",
            x: 90,
            y: 300,
            width: 900,
            fontSize: 96,
            fontWeight: 700,
            color: NAVY,
          }),
          textObject({
            id: "rodape",
            text: "serraazul.example",
            x: 8,
            y: 1260,
            width: 400,
            fontSize: 36,
            color: "#ffffff",
          }),
        ]),
      ],
    });
    const feed = await createContent(s, {
      clientId: cafe.id,
      title: `${PREFIX} — Post de feed`,
      format: "feed",
      copy: "Torra fresca toda semana",
      caption:
        "Da serra para a sua xícara: nossos cafés especiais são torrados toda semana, em pequenos lotes, para chegar até você com todo o aroma da origem. Conte nos comentários qual é o seu ritual preferido.",
      cta: "Peça pela loja online",
      hashtags: ["#cafeespecial", "#torrafresca"],
      plannedDate: "2026-10-30",
    });
    const feedDesign = await createDesign(s, {
      name: `${PREFIX} — Post de feed`,
      width: 1080,
      height: 1350,
      clientId: cafe.id,
      document: feedDoc as unknown as Record<string, unknown>,
    });
    await link(s, feed.id, feedDesign.id, "feed");

    /* Carrossel --------------------------------------------------------------- */
    const slides = ["Capa: o ritual do café", "1. Escolha o grão", "2. Moa na hora", "3. Água a 92 °C"];
    const carouselDoc = createDocument({
      carousel: true,
      pages: slides.map((t, i) =>
        page(1080, 1350, `Slide ${i + 1}`, [
          textObject({
            id: `slide${i + 1}`,
            text: t,
            x: 100,
            // A 3ª página tem o título passando da borda de baixo (o verificador aponta).
            y: i === 2 ? 1290 : 420,
            width: 860,
            fontSize: 80,
            fontWeight: 700,
            color: NAVY,
          }),
        ]),
      ),
    });
    const carousel = await createContent(s, {
      clientId: cafe.id,
      title: `${PREFIX} — Carrossel`,
      format: "carousel",
      copy: "O ritual do café",
      caption: "Quatro passos para um café de origem perfeito em casa. Salve para consultar depois!",
      cta: "Salve este post",
      hashtags: ["#cafeespecial"],
      slides: slides.map((t) => ({ title: t, text: "" })),
      plannedDate: "2026-11-03",
    });
    const carouselDesign = await createDesign(s, {
      name: `${PREFIX} — Carrossel`,
      width: 1080,
      height: 1350,
      clientId: cafe.id,
      document: carouselDoc as unknown as Record<string, unknown>,
    });
    await link(s, carousel.id, carouselDesign.id, "carousel");
    await exportPages(s, carouselDesign.id, cafe.id, carouselDoc, `${PREFIX} carrossel`);

    /* Stories ----------------------------------------------------------------- */
    const storiesDoc = createDocument({
      pages: ["Novidade na serra", "Lote de outono", "Garanta o seu"].map((t, i) =>
        page(
          1080,
          1920,
          `Tela ${i + 1}`,
          [
            textObject({
              id: `story${i + 1}`,
              text: t,
              x: 120,
              // A 1ª tela tem o texto no topo, onde a interface do Stories cobre.
              y: i === 0 ? 90 : 800,
              width: 840,
              fontSize: 90,
              fontWeight: 700,
              color: "#ffffff",
            }),
          ],
          NAVY,
        ),
      ),
    });
    const stories = await createContent(s, {
      clientId: cafe.id,
      title: `${PREFIX} — Stories`,
      format: "stories",
      caption: null,
      plannedDate: "2026-11-05",
    });
    const storiesDesign = await createDesign(s, {
      name: `${PREFIX} — Stories`,
      width: 1080,
      height: 1920,
      clientId: cafe.id,
      document: storiesDoc as unknown as Record<string, unknown>,
    });
    await link(s, stories.id, storiesDesign.id, "stories");

    /* Post enviado ao cliente --------------------------------------------- */
    const sentDoc = createDocument({
      pages: [
        page(1080, 1350, "Página 1", [
          textObject({
            id: "oferta",
            text: "Lote de outono chegou",
            x: 100,
            y: 500,
            width: 880,
            fontSize: 90,
            fontWeight: 700,
            color: NAVY,
          }),
        ]),
      ],
    });
    const sent = await createContent(s, {
      clientId: cafe.id,
      title: `${PREFIX} — Para o cliente`,
      format: "feed",
      caption: "O lote de outono chegou: notas de caramelo e frutas amarelas.",
      cta: "Garanta o seu",
      hashtags: ["#cafeespecial"],
      plannedDate: "2026-11-07",
    });
    const sentDesign = await createDesign(s, {
      name: `${PREFIX} — Para o cliente`,
      width: 1080,
      height: 1350,
      clientId: cafe.id,
      document: sentDoc as unknown as Record<string, unknown>,
    });
    await link(s, sent.id, sentDesign.id, "feed");
    const [fileId] = await exportPages(s, sentDesign.id, cafe.id, sentDoc, `${PREFIX} para o cliente`);
    const internal = await requestApproval(s, { fileId: fileId!, stage: "internal" });
    await decideApproval(s, { approvalId: internal.id, decision: "approved" });
    await requestApproval(s, { fileId: fileId!, stage: "client", message: "Pode aprovar pela prévia." });

    console.log(`  ✓ ${PREFIX}: feed ${feed.id}`);
    console.log(`  ✓ ${PREFIX}: carrossel ${carousel.id}`);
    console.log(`  ✓ ${PREFIX}: stories ${stories.id}`);
    console.log(`  ✓ ${PREFIX}: enviado ao cliente ${sent.id}`);
  });
  console.log("✓ Semente de teste da pré-visualização aplicada.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

/**
 * SEMENTE DE TESTE do Radar de Tendências (só para os testes de ponta a ponta).
 *
 * Coleta as fontes padrão da agência de demonstração usando as respostas
 * GRAVADAS em tests/fixtures/trends (formato real, conteúdo fictício) no lugar
 * da rede, em dois dias seguidos (para haver evidência de crescimento), e
 * ativa o provedor de demonstração da organização. Nunca roda em produção e
 * não tem botão na interface.
 *
 * Uso: ENV_FILE=.env.local npx tsx --tsconfig tsconfig.node.json e2e/seed-trends.ts
 *      (depois de npm run db:seed)
 */
import "../src/worker/load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { inOrg } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { pool, withSystem } from "@/server/db";
import { organizations, trendSources, user } from "@/server/db/schema";
import { updateAiSettings } from "@/server/services/ai";
import { setProviderEnabled } from "@/server/services/ai-providers";
import { listSources, refreshSources } from "@/server/services/trends";
import { ConnectorError } from "@/server/trends/connectors/types";

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
const fx = (name: string) => readFileSync(path.join(__dirname, "..", "tests", "fixtures", "trends", name), "utf8");

function fixtureFetch(day: "yesterday" | "today") {
  const google = fx("google-trends-br.xml");
  return async (url: string) => {
    if (url.startsWith("https://trends.google.com/trending/rss")) {
      return day === "today" ? google.replace("<ht:approx_traffic>2000+", "<ht:approx_traffic>5000+") : google;
    }
    if (url.startsWith("https://wikimedia.org/api/rest_v1/metrics/pageviews/top/")) return fx("wikimedia-top.json");
    throw new ConnectorError("Fonte não disponível na semente de teste.");
  };
}

async function main() {
  const [org] = await withSystem((tx) => tx.select().from(organizations).where(eq(organizations.slug, ORG_SLUG)));
  if (!org) throw new Error(`Rode antes "npm run db:seed" (organização ${ORG_SLUG} não encontrada).`);
  const [owner] = await withSystem((tx) => tx.select().from(user).where(eq(user.email, OWNER)));
  const actor = owner ? await resolveActor(owner.id, ORG_SLUG) : null;
  if (!actor) throw new Error("Conta proprietária da demonstração não encontrada.");

  await inOrg(actor, async (s) => {
    await setProviderEnabled(s, "demo", true);
    await updateAiSettings(s, {
      enabled: true,
      allowClientContext: true,
      monthlyTokenLimit: 0,
      userDailyRequestLimit: 0,
      provider: "demo",
      model: "demo",
    });
    await listSources(s);
  });
  // Recomeça as coletas da semente (permite rodar de novo sem esperar o intervalo).
  await withSystem((tx) =>
    tx.update(trendSources).set({ lastRunAt: null, runningSince: null }).where(eq(trendSources.organizationId, org.id)),
  );
  const now = Date.now();
  const first = await refreshSources(actor, { now: new Date(now - 86_400_000), fetch: fixtureFetch("yesterday") });
  const second = await refreshSources(actor, { now: new Date(now), fetch: fixtureFetch("today") });
  for (const r of [...first, ...second]) {
    console.log(`  ${r.ok ? "✓" : "–"} ${r.name}: ${r.ok ? `${r.count} item(ns)` : (r.skipped ?? r.error)}`);
  }
  console.log("✓ Semente de teste do Radar aplicada (fixtures, provedor de demonstração ativado).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

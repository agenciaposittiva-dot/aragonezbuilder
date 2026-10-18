import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BasisBadge } from "@/components/brand-radar/bits";
import { PrintButton } from "@/components/brand-radar/radar-forms";
import { Button } from "@/components/ui/button";
import {
  BASIS_LABEL,
  BIO_STYLES,
  BRAND_DIMENSIONS,
  CONTENT_CATEGORIES,
  LEVEL3,
  PRESENCE,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_STATUS,
  SOURCE_LABEL,
  type Basis,
  type DiagnosisInputs,
  type DiagnosisResult,
  type Level3,
  type NicheResult,
} from "@/lib/brand-radar";
import { formatDate, formatDateTime } from "@/lib/format";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getRadarWorkspace } from "@/server/services/brand-radar";

export const metadata: Metadata = { title: "Relatório do Radar de Marca" };

const lv = (v: string) => LEVEL3[v as Level3] ?? v;

/* Na impressão (ou "Salvar como PDF"), só o relatório aparece. */
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #radar-report, #radar-report * { visibility: visible !important; }
  #radar-report { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; }
  #radar-report section { break-inside: avoid; }
}`;

export default async function BrandRadarReportPage({ params }: PageProps<"/w/[org]/brand-radar/[id]/report">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "brand.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ws = await inOrg(actor, async (s) => {
    try {
      return await getRadarWorkspace(s, id);
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!ws || ws.profile.kind !== "own") notFound();
  const latest = ws.latest;
  const r = latest ? (latest.result as DiagnosisResult) : null;
  const inputs = latest ? (latest.inputs as DiagnosisInputs) : null;
  const niche = ws.latestNiche ? (ws.latestNiche.result as NicheResult) : null;
  const recs = ws.recommendations.filter((x) => x.status !== "dismissed");
  const chosen = ws.bios.find((b) => b.status === "chosen");

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button size="sm" variant="ghost" asChild>
          <Link href={`/w/${actor.orgSlug}/brand-radar/${ws.profile.id}`}>← Voltar ao Radar</Link>
        </Button>
        <PrintButton />
      </div>
      <article
        id="radar-report"
        className="mx-auto grid max-w-3xl gap-6 rounded-xl border border-border bg-surface p-6 text-sm shadow-xs print:border-0 print:shadow-none"
      >
        <header className="grid gap-1 border-b border-border pb-4">
          <p className="text-xs text-fg-muted">Radar de Marca · relatório</p>
          <h1 className="text-xl font-semibold">@{ws.profile.handle}</h1>
          <p className="text-fg-muted">
            {ws.clientName}
            {ws.profile.niche ? ` · ${ws.profile.niche}` : ""}
          </p>
          {latest ? (
            <p className="text-xs text-fg-subtle">
              Diagnóstico de {formatDateTime(latest.createdAt)} · {latest.provider} / {latest.model} · metodologia v
              {latest.methodologyVersion}
              {latest.demo ? " · MODO DEMONSTRAÇÃO (exemplo, sem análise real)" : ""}
            </p>
          ) : null}
        </header>

        {!latest || !r || !inputs ? (
          <p>Este perfil ainda não tem diagnóstico.</p>
        ) : (
          <>
            <section className="grid gap-2">
              <h2 className="text-base font-semibold">Nota geral: {latest.overallScore ?? "sem nota"} / 100</h2>
              <p className="text-xs text-fg-muted">
                Média ponderada só das dimensões avaliadas ({latest.evaluatedWeight ?? 0} pontos de peso). Itens não
                avaliados ficam fora da conta.
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {r.dimensions.map((d) => (
                    <tr key={d.key} className="border-t border-border align-top">
                      <td className="py-1 pr-3 font-medium">{BRAND_DIMENSIONS[d.key].label}</td>
                      <td className="tabular py-1 pr-3">{d.score ?? "não avaliada"}</td>
                      <td className="py-1 text-fg-muted">{d.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="grid gap-1.5">
              <h2 className="text-base font-semibold">Fontes dos dados</h2>
              <ul className="grid gap-0.5 text-xs">
                {inputs.sources.map((src) => (
                  <li key={src.kind}>
                    • {src.label} — {SOURCE_LABEL[src.kind]}, {formatDateTime(src.collectedAt)}
                  </li>
                ))}
              </ul>
              {inputs.missing.length ? (
                <p className="text-xs text-fg-muted">Faltaram: {inputs.missing.join("; ")}.</p>
              ) : null}
              <p className="text-xs text-fg-muted">
                Legenda: {(Object.keys(BASIS_LABEL) as Basis[]).map((b) => BASIS_LABEL[b]).join(" · ")}.
              </p>
            </section>

            <section className="grid gap-2">
              <h2 className="text-base font-semibold">Resumo</h2>
              <p>{r.summary}</p>
              {[
                ["Pontos fortes", r.strengths],
                ["Problemas", r.problems],
                ["Oportunidades", r.opportunities],
              ].map(([title, items]) =>
                (items as DiagnosisResult["strengths"]).length ? (
                  <div key={title as string} className="grid gap-1">
                    <h3 className="text-xs font-semibold text-fg-muted uppercase">{title as string}</h3>
                    <ul className="grid gap-1">
                      {(items as DiagnosisResult["strengths"]).map((f, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-1.5">
                          <BasisBadge basis={f.basis} /> {f.text}
                          {f.evidence ? <span className="text-xs text-fg-subtle">({f.evidence})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </section>

            {r.bio ? (
              <section className="grid gap-2">
                <h2 className="text-base font-semibold">Biografia</h2>
                <p className="text-xs text-fg-muted">
                  Atual ({r.bio.chars ?? 0}/{r.bio.limit}): {r.bio.current ?? "não informada"}
                </p>
                {chosen ? <p>Escolhida para implementar: {chosen.text}</p> : null}
                <ul className="grid gap-2">
                  {r.bio.versions.map((v) => (
                    <li key={v.style} className="rounded-lg border border-border p-2">
                      <p className="text-xs font-medium">
                        {BIO_STYLES[v.style]} · {v.chars}/{r.bio!.limit}
                      </p>
                      <p className="whitespace-pre-line">{v.text}</p>
                      {v.warnings.length ? (
                        <p className="text-xs text-fg-muted">Atenção: {v.warnings.join(" ")}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {r.highlights?.recommended.length ? (
              <section className="grid gap-2">
                <h2 className="text-base font-semibold">Destaques recomendados</h2>
                <ol className="grid gap-1">
                  {r.highlights.recommended.map((h) => (
                    <li key={h.name}>
                      <strong>{h.name}</strong> — {h.objective}
                      {h.storyIdeas.length ? (
                        <span className="text-fg-muted"> (Stories: {h.storyIdeas.join("; ")})</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <section className="grid gap-1.5">
              <h2 className="text-base font-semibold">Identidade visual</h2>
              {r.visual?.evaluated ? (
                <ul className="grid gap-0.5">
                  {r.visual.items.map((x, i) => (
                    <li key={i}>
                      • {x.criterion}: {x.assessment} ({BASIS_LABEL[x.basis]})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-muted">Não avaliada: {r.visual?.note ?? "sem capturas de tela."}</p>
              )}
            </section>

            {r.content ? (
              <section className="grid gap-1.5">
                <h2 className="text-base font-semibold">Conteúdo</h2>
                <p className="text-xs">
                  {r.content.categories.map((c) => `${CONTENT_CATEGORIES[c.key]}: ${PRESENCE[c.presence]}`).join(" · ")}
                </p>
                {r.content.recommendations.length ? (
                  <ul className="grid gap-0.5">
                    {r.content.recommendations.map((c, i) => (
                      <li key={i}>
                        • {c.idea} — hipótese: {c.hypothesis}
                        {c.howToTest ? ` (como testar: ${c.howToTest})` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        )}

        {niche ? (
          <section className="grid gap-1.5">
            <h2 className="text-base font-semibold">Nicho e concorrentes</h2>
            <p>{niche.niche.summary}</p>
            {niche.niche.opportunities.length ? <p>Oportunidades: {niche.niche.opportunities.join("; ")}</p> : null}
            {niche.niche.competitors.map((c) => (
              <p key={c.handle} className="text-xs">
                @{c.handle}: {c.positioning} ({BASIS_LABEL[c.basis]})
              </p>
            ))}
          </section>
        ) : null}

        {r?.plan30.length ? (
          <section className="grid gap-1.5">
            <h2 className="text-base font-semibold">Plano de 30 dias</h2>
            <ol className="grid gap-1">
              {r.plan30.map((w) => (
                <li key={w.week}>
                  <strong>
                    Semana {w.week} — {w.focus}:
                  </strong>{" "}
                  {w.actions.join("; ")}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {recs.length ? (
          <section className="grid gap-1.5">
            <h2 className="text-base font-semibold">Recomendações</h2>
            <table className="w-full text-xs">
              <thead className="text-left text-fg-subtle">
                <tr>
                  <th className="py-1 pr-2 font-medium">Categoria</th>
                  <th className="py-1 pr-2 font-medium">Recomendação</th>
                  <th className="py-1 pr-2 font-medium">Impacto / esforço</th>
                  <th className="py-1 pr-2 font-medium">Prazo</th>
                  <th className="py-1 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {recs.map((x) => (
                  <tr key={x.id} className="border-t border-border align-top">
                    <td className="py-1 pr-2">{RECOMMENDATION_CATEGORIES[x.category]}</td>
                    <td className="py-1 pr-2">
                      <strong>{x.title}</strong> — {x.nextAction || x.problem}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap">
                      {lv(x.impact)} / {lv(x.effort)}
                    </td>
                    <td className="py-1 pr-2 whitespace-nowrap">{x.dueDate ? formatDate(x.dueDate) : "—"}</td>
                    <td className="py-1">{RECOMMENDATION_STATUS[x.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="border-t border-border pt-3 text-[11px] text-fg-subtle">
          Métricas só aparecem quando vêm da conta conectada pela API oficial. Avaliações da IA são hipóteses a testar;
          mudanças na nota não provam que uma recomendação causou um resultado. Gerado em {formatDateTime(new Date())}.
        </footer>
      </article>
    </>
  );
}

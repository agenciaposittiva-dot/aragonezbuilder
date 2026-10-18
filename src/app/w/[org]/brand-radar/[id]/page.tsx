import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, History, Info, ScanSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BasisBadge,
  DimensionRow,
  FindingList,
  GuardrailNotes,
  Panel,
  ScoreBadge,
  SourceLine,
} from "@/components/brand-radar/bits";
import {
  BioVersions,
  CompareForm,
  ContentIdeaButton,
  HighlightActions,
  RecommendationControls,
  type BioView,
  type RadarOptions,
} from "@/components/brand-radar/radar-actions";
import {
  ArchiveProfileButton,
  CompetitorNotes,
  ConnectionPanel,
  CopyButton,
  ManualDataDialog,
  NewProfileDialog,
  NicheForm,
  RadarAiDialog,
} from "@/components/brand-radar/radar-forms";
import { fileUrl } from "@/components/files/file-icon";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedNav } from "@/components/ui/segmented-nav";
import {
  BRAND_DIMENSIONS,
  CONTENT_CATEGORIES,
  countChars,
  DIAGNOSIS_KINDS,
  LEVEL3,
  POST_FORMATS,
  PRESENCE,
  RECOMMENDATION_AREAS,
  RECOMMENDATION_CATEGORIES,
  SCREENSHOT_KINDS,
  type Basis,
  type DiagnosisInputs,
  type DiagnosisResult,
  type Level3,
  type NicheResult,
  type RecommendationCategory,
} from "@/lib/brand-radar";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError, ValidationError } from "@/server/errors";
import { getPickerData } from "@/server/services/ai-models";
import { compareDiagnoses, getRadarWorkspace, radarFormOptions } from "@/server/services/brand-radar";
import { listCampaigns } from "@/server/services/content";
import { instagramState } from "@/server/services/instagram";

export const metadata: Metadata = { title: "Radar de Marca" };
// As ações de IA chamam o provedor a partir desta página.
export const maxDuration = 120;

const TABS = [
  { value: "overview", label: "Visão geral" },
  { value: "profile", label: "Perfil e biografia" },
  { value: "highlights", label: "Destaques" },
  { value: "visual", label: "Identidade visual" },
  { value: "content", label: "Conteúdo" },
  { value: "niche", label: "Nicho e concorrentes" },
  { value: "plan", label: "Plano de ação" },
  { value: "history", label: "Histórico" },
] as const;
type Tab = (typeof TABS)[number]["value"];

const CATEGORY_ORDER: RecommendationCategory[] = ["fix_now", "improve_soon", "strategic", "monitor", "insufficient"];
const CATEGORY_TONE = {
  fix_now: "danger",
  improve_soon: "warning",
  strategic: "accent",
  monitor: "info",
  insufficient: "neutral",
} as const;
const lv = (v: string) => LEVEL3[v as Level3] ?? v;
const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function BrandRadarProfilePage({ params, searchParams }: PageProps<"/w/[org]/brand-radar/[id]">) {
  const { org, id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "internal", permission: "brand.read" });
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const tab: Tab = TABS.some((t) => t.value === sp.tab) ? (sp.tab as Tab) : "overview";
  const canManage = can(actor, "brand.manage");
  const [a, b] = [str(sp.a), str(sp.b)];

  const data = await inOrg(actor, async (s) => {
    try {
      const ws = await getRadarWorkspace(s, id);
      if (ws.profile.kind !== "own") return null;
      let compare: Awaited<ReturnType<typeof compareDiagnoses>> | null = null;
      let compareError: string | null = null;
      if (tab === "history" && a && b && a !== b) {
        try {
          compare = await compareDiagnoses(s, a, b);
        } catch (err) {
          if (!(err instanceof NotFoundError || err instanceof ValidationError)) throw err;
          compareError = err.message;
        }
      }
      const options = await radarFormOptions(s, ws.profile.clientId);
      return {
        ws,
        compare,
        compareError,
        state: await instagramState(s, id),
        options,
        campaigns: can(actor, "content.read") ? await listCampaigns(s, ws.profile.clientId) : [],
        picker: canManage && can(actor, "ai.use") ? await getPickerData(s) : null,
      };
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const { ws, state } = data;
  const p = ws.profile;
  const base = `/w/${actor.orgSlug}/brand-radar/${p.id}`;
  const latest = ws.latest;
  const result = latest ? (latest.result as DiagnosisResult) : null;
  const inputs = latest ? (latest.inputs as DiagnosisInputs) : null;
  const niche = ws.latestNiche ? (ws.latestNiche.result as NicheResult) : null;
  const options: RadarOptions = {
    projects: data.options.projects,
    members: data.options.members,
    campaigns: data.campaigns.map((c) => ({ id: c.id, name: c.name })),
    can: {
      tasks: can(actor, "tasks.write"),
      projects: can(actor, "projects.write"),
      designs: can(actor, "designs.write"),
      content: can(actor, "content.write"),
      approvals: can(actor, "approvals.request") && can(actor, "files.write"),
    },
  };
  const bios: BioView[] = ws.bios.map((x) => ({
    id: x.id,
    style: x.style,
    text: x.text,
    objective: x.objective,
    strengths: x.strengths,
    cta: x.cta,
    warnings: x.warnings,
    status: x.status,
    fileId: x.fileId,
    taskId: x.taskId,
    createdAt: x.createdAt.toISOString(),
  }));
  const ig = str(sp.ig);
  const aiButton = (
    action: Parameters<typeof RadarAiDialog>[0]["defaultAction"],
    label: string,
    variant: "primary" | "secondary" = "secondary",
  ) =>
    canManage && data.picker ? (
      <RadarAiDialog
        profileId={p.id}
        picker={data.picker}
        screenshots={p.manual.screenshots.length}
        defaultAction={action}
        triggerLabel={label}
        triggerVariant={variant}
      />
    ) : null;

  return (
    <>
      <Breadcrumbs
        items={[{ label: "Radar de Marca", href: `/w/${actor.orgSlug}/brand-radar` }, { label: `@${p.handle}` }]}
      />
      <PageHeader
        title={`@${p.handle}`}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link href={`/w/${actor.orgSlug}/clients/${p.clientId}`} className="hover:underline">
              {ws.clientName}
            </Link>
            {p.niche ? <Badge tone="outline">{p.niche}</Badge> : null}
            <a
              href={p.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent-text hover:underline"
            >
              Abrir no Instagram <ExternalLink className="size-3" />
            </a>
          </span>
        }
        actions={
          <>
            {aiButton("analyze", "Ações de IA", "primary")}
            <Button size="sm" variant="secondary" asChild>
              <Link href={`${base}/report`}>
                <FileText /> Relatório
              </Link>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/brand-radar/export?org=${encodeURIComponent(actor.orgSlug)}&profile=${p.id}`}>
                <Download /> CSV
              </a>
            </Button>
          </>
        }
      >
        <SegmentedNav
          param="tab"
          items={TABS.map((t) => ({ label: t.label, value: t.value, href: `${base}?tab=${t.value}` }))}
        />
      </PageHeader>

      {ig === "connected" ? (
        <p
          className="mb-4 flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft p-3 text-sm"
          role="status"
        >
          <CheckCircle2 className="size-4 text-success" /> Conta conectada pela API oficial. Rode uma análise para usar
          os dados novos.
        </p>
      ) : ig === "error" ? (
        <p
          className="mb-4 flex items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm"
          role="alert"
        >
          <AlertTriangle className="size-4 text-danger" /> {str(sp.msg) ?? "Não foi possível conectar a conta."}
        </p>
      ) : null}

      {result?.demo ? (
        <p
          className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm"
          role="note"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-warning" /> O último diagnóstico foi feito no modo demonstração:
          é um exemplo gerado localmente, sem análise real. Escolha um provedor de IA para um diagnóstico de verdade.
        </p>
      ) : null}

      {tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 content-start gap-5">
            {latest && result ? (
              <>
                <Panel
                  id="score"
                  title="Saúde do perfil"
                  description={`Diagnóstico de ${formatDateTime(latest.createdAt)} · ${latest.provider ?? "—"} / ${latest.model ?? "—"} · metodologia v${latest.methodologyVersion}`}
                >
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <ScoreBadge score={latest.overallScore} size="lg" />
                    <p className="max-w-sm text-xs text-fg-muted" data-testid="evaluated-weight">
                      {latest.overallScore === null
                        ? "Sem dados suficientes para dar uma nota."
                        : `Nota calculada com ${latest.evaluatedWeight} de ${Object.values(latest.weights).reduce((n, w) => n + w, 0)} pontos de peso — o que não foi avaliado ficou de fora.`}
                    </p>
                  </div>
                  <ul className="divide-y divide-border" data-testid="dimensions">
                    {result.dimensions.map((d) => (
                      <DimensionRow
                        key={d.key}
                        d={d}
                        weight={latest.weights[d.key] ?? BRAND_DIMENSIONS[d.key].weight}
                      />
                    ))}
                  </ul>
                  <GuardrailNotes notes={result.guardrails} />
                </Panel>
                <Panel id="summary" title="Resumo">
                  <p className="text-sm">{result.summary}</p>
                  <div className="grid gap-4 md:grid-cols-3">
                    <FindingList title="Pontos fortes" items={result.strengths} empty="Nenhum apontado." />
                    <FindingList title="Problemas" items={result.problems} empty="Nenhum apontado." />
                    <FindingList title="Oportunidades" items={result.opportunities} empty="Nenhuma apontada." />
                  </div>
                </Panel>
              </>
            ) : (
              <div className="rounded-xl border border-border bg-surface shadow-xs">
                <EmptyState
                  icon={ScanSearch}
                  title="Ainda sem diagnóstico"
                  description="1) Conecte a conta oficial ou clique em “Editar dados” para informar bio, destaques, publicações e capturas. 2) Rode “Analisar meu perfil”."
                  action={aiButton("analyze", "Analisar meu perfil", "primary")}
                />
              </div>
            )}
          </div>
          <div className="grid min-w-0 content-start gap-5">
            <Panel id="sources" title="Fontes e dados" description="De onde vem cada informação e quando foi coletada.">
              {inputs ? (
                <ul className="grid gap-1.5 text-sm" data-testid="sources">
                  {inputs.sources.map((src) => (
                    <li key={src.kind} className="grid">
                      <span>{src.label}</span>
                      <SourceLine source={src.kind} collectedAt={src.collectedAt} />
                    </li>
                  ))}
                  {!inputs.sources.length ? <li className="text-xs text-fg-muted">Nenhuma fonte com dados.</li> : null}
                </ul>
              ) : (
                <p className="text-xs text-fg-muted">As fontes aparecem aqui depois do primeiro diagnóstico.</p>
              )}
              {inputs?.missing.length ? (
                <div className="grid gap-1" data-testid="missing">
                  <span className="text-xs font-medium text-fg-muted">Informações que faltaram</span>
                  <ul className="grid gap-0.5 text-xs text-fg-muted">
                    {inputs.missing.map((m) => (
                      <li key={m}>• {m}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                {canManage ? (
                  <ManualDataDialog
                    profileId={p.id}
                    clientId={p.clientId}
                    manual={p.manual}
                    bioLimit={ws.settings.bioLimit}
                    canUpload={can(actor, "files.write")}
                  />
                ) : null}
                <span className="text-xs text-fg-subtle">
                  {p.manual.updatedAt
                    ? `Dados informados em ${formatDateTime(p.manual.updatedAt)}`
                    : "Nenhum dado informado ainda"}
                </span>
              </div>
            </Panel>
            <Panel id="connection" title="Conexão oficial com o Instagram">
              <ConnectionPanel profileId={p.id} state={state} canManage={canManage} />
            </Panel>
            {canManage ? (
              <div>
                <ArchiveProfileButton id={p.id} redirectTo={`/w/${actor.orgSlug}/brand-radar`} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="grid gap-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              id="bio-now"
              title="Bio atual"
              actions={aiButton("bio", "Reescrever minha bio")}
              description={
                inputs?.profile.bio ? (
                  <SourceLine source={inputs.profile.bio.source} collectedAt={inputs.profile.bio.collectedAt} />
                ) : undefined
              }
            >
              {(inputs?.profile.bio?.value ?? p.manual.bio) ? (
                <>
                  <p className="rounded-lg bg-surface-2/60 p-2.5 text-sm whitespace-pre-line">
                    {inputs?.profile.bio?.value ?? p.manual.bio}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {countChars(inputs?.profile.bio?.value ?? p.manual.bio)} de {ws.settings.bioLimit} caracteres
                  </p>
                </>
              ) : (
                <p className="text-sm text-fg-muted">
                  Bio não informada. Use “Editar dados” na visão geral ou conecte a conta.
                </p>
              )}
              {p.plannedBio ? (
                <div
                  className="grid gap-1 rounded-lg border border-success/40 bg-success-soft/40 p-2.5"
                  data-testid="planned-bio"
                >
                  <span className="text-xs font-medium">
                    Bio escolhida para implementar{p.plannedBioAt ? ` (${formatDate(p.plannedBioAt)})` : ""} — o
                    Instagram não foi alterado
                  </span>
                  <p className="text-sm whitespace-pre-line">{p.plannedBio}</p>
                  <div>
                    <CopyButton text={p.plannedBio} />
                  </div>
                </div>
              ) : null}
            </Panel>
            <Panel id="bio-audit" title="Auditoria da bio" description="Critérios avaliados no último diagnóstico.">
              {result?.bio?.audit.length ? (
                <ul className="grid gap-1.5 text-sm">
                  {result.bio.audit.map((x, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <Badge
                        tone={
                          x.assessment === "ok"
                            ? "success"
                            : x.assessment === "improve"
                              ? "warning"
                              : x.assessment === "missing"
                                ? "danger"
                                : "outline"
                        }
                      >
                        {
                          { ok: "Ok", improve: "Melhorar", missing: "Falta", not_evaluated: "Não avaliado" }[
                            x.assessment
                          ]
                        }
                      </Badge>
                      <span>
                        <span className="font-medium">{x.criterion}</span>
                        {x.note ? <span className="text-fg-muted"> — {x.note}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-fg-muted">Rode um diagnóstico para auditar a bio.</p>
              )}
              {result ? (
                <div className="grid gap-1 border-t border-border pt-2">
                  <span className="text-xs font-medium text-fg-muted">Completude (regra objetiva)</span>
                  <ul className="grid gap-0.5 text-xs">
                    {result.objective.completeness.checks.map((c) => (
                      <li key={c.label}>
                        {c.ok === null ? "○" : c.ok ? "✓" : "✗"} {c.label}
                        {c.ok === null ? " — não informado" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Panel>
          </div>
          <Panel
            id="bio-versions"
            title="Versões sugeridas"
            description="Edite, copie e compare. “Usar esta versão” grava no cadastro do perfil (não no Instagram)."
          >
            {bios.length ? (
              <BioVersions
                profileId={p.id}
                versions={bios.slice(0, 12)}
                limit={ws.settings.bioLimit}
                current={inputs?.profile.bio?.value ?? (p.manual.bio || null)}
                options={options}
                canManage={canManage}
              />
            ) : (
              <p className="text-sm text-fg-muted">Ainda não há versões. Use “Reescrever minha bio”.</p>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "highlights" ? (
        <div className="grid gap-5">
          <Panel
            id="hl-now"
            title="Destaques atuais"
            actions={aiButton("highlights", "Planejar meus destaques")}
            description={
              inputs?.highlights ? (
                <SourceLine source={inputs.highlights.source} collectedAt={inputs.highlights.collectedAt} />
              ) : undefined
            }
          >
            {result?.highlights?.current.length ? (
              <div className="flex flex-wrap gap-1.5">
                {result.highlights.current.map((h) => (
                  <Badge key={h} tone="outline">
                    {h}
                  </Badge>
                ))}
              </div>
            ) : null}
            {result?.highlights ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <BasisBadge basis={result.highlights.basis} /> {result.highlights.assessment}
              </p>
            ) : (
              <p className="text-sm text-fg-muted">Rode um diagnóstico para avaliar os destaques.</p>
            )}
          </Panel>
          {result?.highlights?.recommended.length && latest ? (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="highlight-plans">
              {result.highlights.recommended.map((h, i) => (
                <li
                  key={`${h.name}-${i}`}
                  data-testid="highlight-plan"
                  className="grid content-start gap-2 rounded-xl border border-border bg-surface p-3 shadow-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {h.order}. {h.name}
                    </span>
                    <BasisBadge basis="hypothesis" />
                  </div>
                  <p className="text-sm text-fg-muted">{h.objective}</p>
                  {h.storyIdeas.length ? (
                    <div>
                      <span className="text-xs font-medium text-fg-muted">Ideias de Stories</span>
                      <ul className="grid gap-0.5 text-sm">
                        {h.storyIdeas.map((x) => (
                          <li key={x}>• {x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="text-xs">
                    <span className="font-medium text-fg-muted">Direção da capa: </span>
                    {h.coverDirection}
                  </p>
                  <div className="grid gap-1 rounded-lg bg-surface-2/60 p-2 text-xs">
                    <span className="font-medium text-fg-muted">Prompt da capa</span>
                    <span>{h.coverPrompt}</span>
                    <div>
                      <CopyButton text={h.coverPrompt} label="Copiar prompt" />
                    </div>
                  </div>
                  {canManage ? <HighlightActions diagnosisId={latest.id} index={i} options={options} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === "visual" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            id="visual"
            title="Identidade visual e grade"
            actions={aiButton("visual", "Melhorar a identidade visual")}
          >
            {result?.visual?.evaluated ? (
              <>
                <p className="text-sm">{result.visual.note}</p>
                <ul className="grid gap-2">
                  {result.visual.items.map((x, i) => (
                    <li key={i} className="grid gap-1 rounded-lg border border-border p-2.5">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{x.criterion}</span>
                        <BasisBadge basis={x.basis} />
                      </span>
                      <span className="text-sm text-fg-muted">{x.assessment}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="grid gap-2 text-sm" data-testid="visual-not-evaluated">
                <BasisBadge basis="insufficient" />
                <p>
                  Não dá para avaliar a identidade visual
                  {result?.visual?.note ? `: ${result.visual.note}` : " sem um diagnóstico com capturas de tela."}
                </p>
                <p className="text-xs text-fg-muted">
                  Envie capturas do perfil e da grade em “Editar dados” e escolha um modelo que leia imagens (Claude,
                  Gemini ou OpenAI com visão).
                </p>
              </div>
            )}
          </Panel>
          <Panel id="shots" title="Capturas de tela" description="Arquivos do cliente usados na análise.">
            {(inputs?.screenshots ?? p.manual.screenshots).length ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(inputs?.screenshots ?? p.manual.screenshots).map((sh) => (
                  <li key={sh.fileId} className="grid gap-1">
                    <Link href={`/w/${actor.orgSlug}/files/${sh.fileId}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fileUrl(sh.versionId, { thumb: true })}
                        alt={sh.name}
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                    </Link>
                    <span className="truncate text-[11px] text-fg-subtle">{SCREENSHOT_KINDS[sh.kind]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Nenhuma captura enviada.</p>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "content" ? (
        <div className="grid gap-5">
          <Panel
            id="categories"
            title="Categorias de conteúdo"
            description="Presença de cada categoria nas publicações informadas. Sem publicações, não dá para avaliar."
          >
            {result?.content ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="content-categories">
                {result.content.categories.map((c) => (
                  <li
                    key={c.key}
                    className="grid gap-1 rounded-lg border border-border p-2.5"
                    data-presence={c.presence}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{CONTENT_CATEGORIES[c.key]}</span>
                      <Badge
                        tone={
                          c.presence === "present"
                            ? "success"
                            : c.presence === "low"
                              ? "warning"
                              : c.presence === "absent"
                                ? "danger"
                                : "outline"
                        }
                      >
                        {PRESENCE[c.presence]}
                      </Badge>
                    </span>
                    {c.note ? <span className="text-xs text-fg-muted">{c.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Rode um diagnóstico para avaliar o conteúdo.</p>
            )}
            {result ? (
              <p className="text-xs text-fg-muted">
                Formatos (regra objetiva): {result.objective.formats.note}
                {result.objective.performance.score !== null
                  ? ` · Desempenho: ${result.objective.performance.note}`
                  : ""}
              </p>
            ) : null}
          </Panel>
          <Panel
            id="ideas"
            title="Ideias para testar"
            description="Recomendações de conteúdo são hipóteses: cada uma diz como testar. Resultados só contam com dados reais."
          >
            {result?.content?.recommendations.length && latest ? (
              <ul className="grid gap-2 md:grid-cols-2">
                {result.content.recommendations.map((r, i) => (
                  <li key={i} className="grid content-start gap-1.5 rounded-lg border border-border p-3">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.idea}</span>
                      <BasisBadge basis="hypothesis" />
                    </span>
                    <span className="text-sm text-fg-muted">{r.hypothesis}</span>
                    {r.howToTest ? <span className="text-xs">Como testar: {r.howToTest}</span> : null}
                    {canManage && options.can.content ? (
                      <div>
                        <ContentIdeaButton diagnosisId={latest.id} index={i} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-muted">Sem ideias ainda.</p>
            )}
          </Panel>
          {inputs?.posts?.items.length ? (
            <Panel
              id="posts"
              title="Publicações usadas"
              description={<SourceLine source={inputs.posts.source} collectedAt={inputs.posts.collectedAt} />}
            >
              <ul className="grid gap-1 text-sm">
                {inputs.posts.items.slice(0, 30).map((post, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 border-b border-border py-1 last:border-0">
                    <Badge tone="outline">{post.format ? POST_FORMATS[post.format] : "Formato não informado"}</Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {"caption" in post ? post.caption || "(sem legenda)" : post.text}
                    </span>
                    {"likes" in post && (post.likes !== null || post.comments !== null) ? (
                      <span className="tabular text-xs text-fg-subtle">
                        {post.likes ?? "—"} curtidas · {post.comments ?? "—"} comentários
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}

      {tab === "niche" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid min-w-0 content-start gap-5">
            <Panel id="niche-form" title="Nicho, mercado e região">
              {canManage ? (
                <NicheForm profileId={p.id} values={{ niche: p.niche, market: p.market, region: p.region }} />
              ) : (
                <p className="text-sm">
                  {[p.niche, p.market, p.region].filter(Boolean).join(" · ") || "Não informado."}
                </p>
              )}
            </Panel>
            <Panel
              id="competitors"
              title="Concorrentes"
              description="Só o que a equipe informa: não há coleta automática de outros perfis."
              actions={
                canManage ? (
                  <NewProfileDialog
                    clients={[{ id: p.clientId, name: ws.clientName }]}
                    defaultClientId={p.clientId}
                    kind="competitor"
                  />
                ) : null
              }
            >
              {ws.competitors.length ? (
                <ul className="grid gap-3" data-testid="competitors">
                  {ws.competitors.map((c) => (
                    <li key={c.id} className="grid gap-1.5 rounded-lg border border-border p-2.5">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <a
                          href={c.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium hover:underline"
                        >
                          @{c.handle}
                        </a>
                        {canManage ? (
                          <ArchiveProfileButton
                            id={c.id}
                            label="Remover concorrente"
                            description="O concorrente sai das próximas comparações."
                          />
                        ) : null}
                      </span>
                      {canManage ? (
                        <CompetitorNotes id={c.id} notes={c.notes} />
                      ) : c.notes ? (
                        <p className="text-xs">{c.notes}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">Nenhum concorrente cadastrado.</p>
              )}
            </Panel>
          </div>
          <Panel
            id="niche-analysis"
            title="Leitura do nicho"
            actions={
              <>
                {aiButton("niche", "Encontrar oportunidades")}
                {aiButton("competitors", "Comparar com concorrentes")}
              </>
            }
            description={
              ws.latestNiche
                ? `Análise de ${formatDateTime(ws.latestNiche.createdAt)} · ${ws.latestNiche.model ?? ""}`
                : undefined
            }
          >
            {niche ? (
              <div className="grid gap-3 text-sm">
                <p>{niche.niche.summary}</p>
                <NicheList title="Fatos (dos dados informados)" items={niche.niche.facts} basis="observed" />
                <NicheList title="Hipóteses" items={niche.niche.hypotheses} basis="hypothesis" />
                <NicheList title="Oportunidades" items={niche.niche.opportunities} basis="hypothesis" />
                {niche.niche.competitors.length ? (
                  <div className="grid gap-1.5">
                    <span className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Comparação</span>
                    <ul className="grid gap-2">
                      {niche.niche.competitors.map((c) => (
                        <li key={c.handle} className="grid gap-1 rounded-lg border border-border p-2.5">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium">@{c.handle}</span>
                            <BasisBadge basis={c.basis} />
                          </span>
                          <span className="text-fg-muted">{c.positioning}</span>
                          {c.differences ? <span className="text-xs">Diferenças: {c.differences}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <GuardrailNotes notes={niche.guardrails} />
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Ainda sem leitura do nicho.</p>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "plan" ? (
        <div className="grid gap-5">
          {result?.plan30.length ? (
            <Panel id="plan30" title="Plano de 30 dias" actions={aiButton("plan", "Montar plano de 30 dias")}>
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {result.plan30.map((w) => (
                  <li key={w.week} className="grid content-start gap-1 rounded-lg border border-border p-3">
                    <span className="text-xs font-medium text-fg-muted">Semana {w.week}</span>
                    <span className="text-sm font-semibold">{w.focus}</span>
                    <ul className="grid gap-0.5 text-sm">
                      {w.actions.map((x) => (
                        <li key={x}>• {x}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
          {ws.recommendations.length ? (
            CATEGORY_ORDER.map((cat) => {
              const items = ws.recommendations
                .filter((r) => r.category === cat)
                .sort(
                  (x, y) =>
                    Number(x.status === "done" || x.status === "dismissed") -
                      Number(y.status === "done" || y.status === "dismissed") || x.priority - y.priority,
                );
              if (!items.length) return null;
              return (
                <section key={cat} className="grid gap-3" aria-labelledby={`cat-${cat}`}>
                  <h2 id={`cat-${cat}`} className="flex items-center gap-2 text-sm font-semibold">
                    <Badge tone={CATEGORY_TONE[cat]}>{RECOMMENDATION_CATEGORIES[cat]}</Badge>
                    <span className="text-fg-subtle">{items.length}</span>
                  </h2>
                  <ul className="grid gap-3 lg:grid-cols-2" data-testid={`recs-${cat}`}>
                    {items.map((r) => (
                      <li
                        key={r.id}
                        data-testid="recommendation"
                        className={cn(
                          "grid min-w-0 content-start gap-2 rounded-xl border border-border bg-surface p-3 shadow-xs",
                          (r.status === "done" || r.status === "dismissed") && "opacity-70",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="text-sm font-semibold">{r.title}</span>
                          <span className="flex flex-wrap gap-1">
                            <Badge tone="outline">{RECOMMENDATION_AREAS[r.area]}</Badge>
                            <BasisBadge basis={r.basis as Basis} />
                          </span>
                        </div>
                        <p className="text-sm">{r.problem}</p>
                        {r.evidence ? (
                          <p className="text-xs text-fg-muted">
                            Evidência: {r.evidence}
                            {r.evidenceSource ? ` (fonte: ${r.evidenceSource})` : ""}
                          </p>
                        ) : null}
                        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          <div>
                            <dt className="inline text-fg-muted">Impacto: </dt>
                            <dd className="inline">{lv(r.impact)}</dd>
                          </div>
                          <div>
                            <dt className="inline text-fg-muted">Esforço: </dt>
                            <dd className="inline">{lv(r.effort)}</dd>
                          </div>
                          <div>
                            <dt className="inline text-fg-muted">Confiança: </dt>
                            <dd className="inline">{lv(r.confidence)}</dd>
                          </div>
                          {r.assigneeName ? (
                            <div>
                              <dt className="inline text-fg-muted">Responsável: </dt>
                              <dd className="inline">{r.assigneeName}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt className="inline text-fg-muted">Diagnóstico: </dt>
                            <dd className="inline">{formatDate(r.createdAt)}</dd>
                          </div>
                        </dl>
                        {r.nextAction ? (
                          <p className="text-sm">
                            <span className="font-medium">Próxima ação:</span> {r.nextAction}
                          </p>
                        ) : null}
                        {r.howToTest ? <p className="text-xs text-fg-muted">Como testar: {r.howToTest}</p> : null}
                        <RecommendationControls
                          rec={{
                            id: r.id,
                            status: r.status,
                            category: r.category,
                            priority: r.priority,
                            assigneeMembershipId: r.assigneeMembershipId,
                            dueDate: r.dueDate,
                            taskId: r.taskId,
                            designId: r.designId,
                            contentItemId: r.contentItemId,
                          }}
                          options={options}
                          canManage={canManage}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          ) : (
            <div className="rounded-xl border border-border bg-surface shadow-xs">
              <EmptyState
                icon={ScanSearch}
                title="Sem recomendações ainda"
                description="O plano de ação nasce do diagnóstico."
                action={aiButton("analyze", "Analisar meu perfil", "primary")}
              />
            </div>
          )}
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="grid gap-5">
          {ws.diagnoses.filter((d) => d.kind === "full").length >= 2 ? (
            <Panel
              id="compare"
              title="Comparar diagnósticos"
              actions={aiButton("reassess", "Reavaliar depois das mudanças")}
            >
              <CompareForm
                base={base}
                a={a}
                b={b}
                options={ws.diagnoses
                  .filter((d) => d.kind === "full")
                  .map((d) => ({
                    id: d.id,
                    label: `${formatDateTime(d.createdAt)} · ${d.overallScore ?? "sem nota"}${d.demo ? " · demonstração" : ""}`,
                  }))}
              />
              {data.compareError ? <p className="text-sm text-danger">{data.compareError}</p> : null}
              {data.compare ? <CompareView c={data.compare} /> : null}
            </Panel>
          ) : (
            <Panel
              id="compare"
              title="Comparar diagnósticos"
              actions={aiButton("reassess", "Reavaliar depois das mudanças")}
            >
              <p className="text-sm text-fg-muted">A comparação aparece quando houver dois diagnósticos completos.</p>
            </Panel>
          )}
          <Panel id="timeline" title="Linha do tempo">
            {ws.diagnoses.length ? (
              <ol className="grid gap-2" data-testid="timeline">
                {ws.diagnoses.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5 text-sm"
                  >
                    <History className="size-4 text-fg-subtle" />
                    <span className="font-medium">{DIAGNOSIS_KINDS[d.kind]}</span>
                    <span className="text-fg-muted">{formatDateTime(d.createdAt)}</span>
                    {d.kind === "full" ? <ScoreBadge score={d.overallScore} /> : null}
                    {d.demo ? <Badge tone="warning">Demonstração</Badge> : null}
                    <span className="text-xs text-fg-subtle">
                      {d.provider} / {d.model}
                      {d.createdBy ? ` · ${d.createdBy}` : ""} · metodologia v{d.methodologyVersion}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-fg-muted">Nenhum diagnóstico ainda.</p>
            )}
          </Panel>
        </div>
      ) : null}
    </>
  );
}

function NicheList({ title, items, basis }: { title: string; items: string[]; basis: Basis }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        {title} <BasisBadge basis={basis} />
      </span>
      <ul className="grid gap-0.5">
        {items.map((x) => (
          <li key={x}>• {x}</li>
        ))}
      </ul>
    </div>
  );
}

function CompareView({ c }: { c: Awaited<ReturnType<typeof compareDiagnoses>> }) {
  const delta = c.before.score !== null && c.after.score !== null ? c.after.score - c.before.score : null;
  return (
    <div className="grid gap-3" data-testid="compare-view">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {formatDate(c.before.createdAt)}: <strong>{c.before.score ?? "—"}</strong>
        </span>
        <span aria-hidden="true">→</span>
        <span>
          {formatDate(c.after.createdAt)}: <strong>{c.after.score ?? "—"}</strong>
        </span>
        {delta !== null ? (
          <Badge tone={delta > 0 ? "success" : delta < 0 ? "danger" : "neutral"}>
            {delta > 0 ? "+" : ""}
            {delta}
          </Badge>
        ) : null}
        {c.demo ? <Badge tone="warning">Inclui demonstração</Badge> : null}
      </div>
      {c.methodologyChanged ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-2.5 text-xs" role="note">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> A metodologia ou os pesos mudaram entre os
          dois diagnósticos: compare as dimensões, não só a nota geral.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-fg-subtle">
            <tr>
              <th className="py-1 pr-3 font-medium">Dimensão</th>
              <th className="py-1 pr-3 font-medium">Antes</th>
              <th className="py-1 pr-3 font-medium">Depois</th>
              <th className="py-1 font-medium">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {c.dimensions.map((d) => (
              <tr key={d.key} className="border-t border-border">
                <td className="py-1 pr-3">{d.label}</td>
                <td className="tabular py-1 pr-3">{d.before ?? "não avaliada"}</td>
                <td className="tabular py-1 pr-3">{d.after ?? "não avaliada"}</td>
                <td className="tabular py-1">{d.delta === null ? "—" : `${d.delta > 0 ? "+" : ""}${d.delta}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1 text-xs">
          <span className="font-medium text-fg-muted">Bio</span>
          <p className="whitespace-pre-line">Antes: {c.bio.before ?? "não informada"}</p>
          <p className="whitespace-pre-line">Depois: {c.bio.after ?? "não informada"}</p>
        </div>
        <div className="grid gap-1 text-xs">
          <span className="font-medium text-fg-muted">Destaques</span>
          <p>Antes: {c.highlights.before.join(", ") || "não informados"}</p>
          <p>Depois: {c.highlights.after.join(", ") || "não informados"}</p>
        </div>
      </div>
      <p className="text-xs">
        Recomendações do diagnóstico anterior: {c.recommendations.done} concluída(s), {c.recommendations.pending} em
        aberto, {c.recommendations.dismissed} descartada(s).
      </p>
      <p className="text-xs">
        Seguidores (só da conta conectada):{" "}
        {c.followers.before && c.followers.after
          ? `${c.followers.before.value} → ${c.followers.after.value}`
          : "sem métricas reais nos dois diagnósticos — não comparado."}
      </p>
      <p className="text-xs text-fg-muted">
        Mudanças na nota não provam que uma recomendação causou um resultado: outros fatores (época, campanhas,
        anúncios) também influenciam.
      </p>
    </div>
  );
}

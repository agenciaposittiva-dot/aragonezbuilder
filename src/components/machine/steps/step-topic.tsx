"use client";

import {
  ExternalLink,
  FileText,
  Flame,
  Link2,
  Lightbulb,
  Search,
  Sparkles,
  TrendingUp,
  Type,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import type { AiSelection } from "@/lib/ai-select";
import { SOURCE_KINDS, type MachineSource, type SourceKind } from "@/lib/content-machine";
import { formatDate, relativeFromNow } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  machineFileSourceAction,
  machineLinkSourceAction,
  machineOpportunityAction,
  machineTrendOptionsAction,
  machineTrendSourceAction,
} from "@/server/actions/content-machine";
import type { StepProps, TrendOption } from "../machine-wizard";
import { CostPrompt } from "./cost-prompt";
import { OpportunityCard } from "./opportunity-card";

const KIND_ICON: Record<SourceKind, React.ReactNode> = {
  idea: <Lightbulb />,
  trend: <TrendingUp />,
  link: <Link2 />,
  text: <Type />,
  file: <FileText />,
};

const typed = (kind: "idea" | "text", text: string): MachineSource => ({
  kind,
  text,
  title: text.split("\n")[0]!.slice(0, 160),
  url: null,
  siteName: null,
  trendId: null,
  fileId: null,
  publishedAt: null,
  collectedAt: null,
});

/**
 * Etapa 2: o assunto — ideia própria, tema do Radar, link, texto ou arquivo — e
 * a oportunidade (o que é fato coletado fica separado do que a IA sugere).
 */
export function StepTopic(props: StepProps) {
  const { view, state, update, server, can, picker, readOnly, clientId } = props;
  const { orgSlug } = useWorkspace();
  const [kind, setKind] = useState<SourceKind>(state.source?.kind ?? "idea");
  const [url, setUrl] = useState(state.source?.kind === "link" ? (state.source.url ?? "") : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const kinds = (Object.keys(SOURCE_KINDS) as SourceKind[]).filter(
    (k) => (k !== "trend" || can.trends) && (k !== "file" || can.files),
  );
  const src = state.source;
  const setSource = (source: MachineSource | null) => update({ source, opportunity: null });

  const readLink = async () => {
    setBusy("link");
    const res = await server(() => machineLinkSourceAction(orgSlug, { id: view.project.id, url: url.trim() }));
    if (res) setSource(res.source);
    setBusy(null);
  };

  const research = async (confirmCost = false) => {
    setBusy("research");
    setCost(null);
    const res = await server(
      () =>
        machineOpportunityAction(orgSlug, {
          id: view.project.id,
          selection: (state.ai.research ?? undefined) as AiSelection | undefined,
          confirmCost,
        }),
      { onCost: setCost },
    );
    if (res) {
      update({ opportunity: res.opportunity });
      if (res.notice) toast.info(res.notice);
    }
    setBusy(null);
  };

  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Origem do assunto" className="flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            disabled={readOnly}
            onClick={() => setKind(k)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors [&_svg]:size-4",
              kind === k ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-border hover:bg-surface-2",
            )}
          >
            {KIND_ICON[k]} {SOURCE_KINDS[k]}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {kind === "idea" || kind === "text" ? (
          <Field
            label={kind === "idea" ? "Qual é a ideia?" : "Cole o texto (artigo, roteiro, anotações)"}
            htmlFor="machine-source-text"
            hint={
              kind === "idea"
                ? "Uma frase já basta. Ideias são tratadas como hipótese editorial (sem dados de popularidade)."
                : "O texto vira a referência do roteiro: números só entram se estiverem aqui."
            }
          >
            <Textarea
              id="machine-source-text"
              rows={kind === "idea" ? 3 : 8}
              maxLength={8000}
              readOnly={readOnly}
              value={src?.kind === kind ? src.text : ""}
              onChange={(e) => setSource(e.target.value.trim() ? typed(kind, e.target.value) : null)}
              placeholder={kind === "idea" ? "Ex.: Como escolher o café certo para cada método de preparo" : ""}
            />
          </Field>
        ) : null}

        {kind === "link" ? (
          <div className="grid gap-2">
            <Field
              label="Link do artigo ou página"
              htmlFor="machine-source-url"
              hint="Usamos só o texto público da página (sem login ou conteúdo pago)."
            >
              <div className="flex gap-2">
                <Input
                  id="machine-source-url"
                  type="url"
                  inputMode="url"
                  value={url}
                  readOnly={readOnly}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://"
                />
                <Button
                  variant="secondary"
                  loading={busy === "link"}
                  disabled={readOnly || url.trim().length < 8}
                  onClick={() => void readLink()}
                >
                  Ler página
                </Button>
              </div>
            </Field>
          </div>
        ) : null}

        {kind === "file" ? <FileSource {...props} clientId={clientId} setSource={setSource} /> : null}
        {kind === "trend" ? <TrendSource {...props} setSource={setSource} /> : null}
      </div>

      {src && (src.text || src.title) ? <SourceCard source={src} /> : null}

      {src && (src.text || src.title) ? (
        <div className="grid gap-4 border-t border-border pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="font-medium">Oportunidade</p>
              <p className="text-sm text-fg-muted">
                A IA resume a fonte, explica a relevância para a marca e aponta riscos. Opcional, mas melhora os
                ângulos.
              </p>
            </div>
            {can.ai && picker ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <AiModelPicker
                  providers={picker.providers}
                  preferences={picker.preferences}
                  task="trend_analysis"
                  module="machine"
                  value={(state.ai.research ?? { mode: "default" }) as AiSelection}
                  onChange={(v) => update((s) => ({ ...s, ai: { ...s.ai, research: v as Record<string, unknown> } }))}
                  disabled={readOnly}
                />
                <Button
                  variant="secondary"
                  loading={busy === "research"}
                  disabled={readOnly}
                  onClick={() => void research()}
                  data-testid="machine-research"
                >
                  <Sparkles /> {state.opportunity ? "Analisar de novo" : "Analisar oportunidade"}
                </Button>
              </div>
            ) : null}
          </div>
          {cost ? (
            <CostPrompt message={cost} onConfirm={() => void research(true)} onCancel={() => setCost(null)} />
          ) : null}
          {state.opportunity ? <OpportunityCard o={state.opportunity} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceCard({ source }: { source: MachineSource }) {
  return (
    <div data-testid="machine-source" className="rounded-lg border border-border bg-surface-2/30 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{SOURCE_KINDS[source.kind]}</Badge>
        {source.siteName ? <span className="text-xs text-fg-muted">{source.siteName}</span> : null}
        {source.publishedAt ? (
          <span className="text-xs text-fg-muted">· publicado em {formatDate(source.publishedAt)}</span>
        ) : source.collectedAt ? (
          <span className="text-xs text-fg-muted">· coletado em {formatDate(source.collectedAt)}</span>
        ) : null}
      </div>
      <p className="mt-2 font-medium">{source.title}</p>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent-text hover:underline"
        >
          <span className="truncate">{source.url}</span> <ExternalLink className="size-3 shrink-0" />
        </a>
      ) : null}
      {source.text && source.kind !== "idea" ? (
        <p className="mt-2 line-clamp-4 whitespace-pre-line text-fg-muted">{source.text}</p>
      ) : null}
    </div>
  );
}

function TrendSource({
  view,
  trends,
  server,
  readOnly,
  setSource,
}: StepProps & { setSource: (s: MachineSource) => void }) {
  const { orgSlug } = useWorkspace();
  const [q, setQ] = useState("");
  const [list, setList] = useState<TrendOption[]>(trends);
  const [busy, setBusy] = useState<string | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const res = await machineTrendOptionsAction(orgSlug, { q: q.trim() || undefined }).catch(() => null);
      if (res?.ok) setList(res.data.map((x) => ({ ...x, lastSeenAt: new Date(x.lastSeenAt).toISOString() })));
    }, 350);
    return () => clearTimeout(t);
  }, [q, orgSlug]);
  const pick = async (trendId: string) => {
    setBusy(trendId);
    const res = await server(() => machineTrendSourceAction(orgSlug, { id: view.project.id, trendId }));
    if (res) setSource(res.source);
    setBusy(null);
  };
  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          aria-label="Buscar no Radar de Tendências"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar no Radar de Tendências"
          className="pl-9"
        />
      </div>
      {list.length ? (
        <ul className="grid max-h-96 gap-2 overflow-y-auto pr-1">
          {list.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={readOnly || !!busy}
                onClick={() => void pick(t.id)}
                className={cn(
                  "w-full rounded-lg border border-border p-3 text-left text-sm transition-colors hover:bg-surface-2",
                  view.state.source?.trendId === t.id && "border-accent bg-accent-soft/40",
                )}
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-medium">{t.title}</p>
                  {t.observations > 0 ? (
                    <Badge tone="success">
                      <Flame /> Em alta
                    </Badge>
                  ) : (
                    <Badge tone="outline">Sem dados de popularidade</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  {t.sourceName} · visto {relativeFromNow(t.lastSeenAt)}
                </p>
                {t.summary ? <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{t.summary}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">
          Nenhum tema encontrado. As fontes do Radar de Tendências coletam temas periodicamente.
        </p>
      )}
    </div>
  );
}

function FileSource({
  view,
  server,
  readOnly,
  clientId,
  setSource,
}: StepProps & { setSource: (s: MachineSource) => void }) {
  const { orgSlug } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.set("orgSlug", orgSlug);
      form.set("clientId", clientId);
      form.set("category", "reference");
      form.set("tags", "maquina-de-conteudo");
      form.append("file", file, file.name);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: { fileId?: string; error?: string }[];
      };
      const r = body.results?.[0];
      if (!res.ok || !r?.fileId) {
        toast.error(r?.error ?? body.error ?? "Falha ao enviar o arquivo.");
        return;
      }
      const set = await server(() => machineFileSourceAction(orgSlug, { id: view.project.id, fileId: r.fileId! }));
      if (set) setSource(set.source);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-sm text-fg-muted">
        Envie um arquivo de texto (.txt, .md ou .csv). Ele fica em Arquivos, junto do cliente. Para PDF ou Word, cole o
        texto na opção &quot;Texto colado&quot;.
      </p>
      <input
        ref={input}
        type="file"
        accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
        className="sr-only"
        aria-label="Arquivo de texto"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <div>
        <Button variant="secondary" loading={busy} disabled={readOnly} onClick={() => input.current?.click()}>
          <Upload /> Escolher arquivo
        </Button>
      </div>
    </div>
  );
}

"use client";

import {
  AlertTriangle,
  CalendarClock,
  ListChecks,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { PriorityLabel, PRIORITY_OPTIONS } from "@/components/app/priority";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgAction } from "@/hooks/use-action";
import type { AiSelection } from "@/lib/ai-select";
import type { AiTask } from "@/lib/ai-tasks";
import { formatDate } from "@/lib/format";
import {
  DUE_ORIGIN_LABEL,
  TASK_AI_MODES,
  type PlanItem,
  type Priority,
  type TaskAiRequest,
  type TaskAiResult,
} from "@/lib/task-ai";
import { addCommentAction } from "@/server/actions/comments";
import { applyTaskBreakdownAction, applyTaskPlanAction, taskAiSetupAction } from "@/server/actions/task-ai";
import { updateTaskAction } from "@/server/actions/tasks";
import type { TaskAiSetup } from "@/server/services/task-ai";

type ProjectOpt = { id: string; name: string; clientName: string };
type MemberOpt = { membershipId: string; name: string };
type Alternative = { provider: string; providerLabel: string; model: string; label: string };
type Meta = {
  demo: boolean;
  providerLabel: string;
  modelLabel: string;
  reason: string;
  warnings: string[];
  contextUsed: boolean;
} | null;

/* ------------------------------------------------------------------ */
/* Execução (rota /api/tasks/ai — só gera a proposta, nunca grava)     */
/* ------------------------------------------------------------------ */

function useSetup() {
  const [setup, setSetup] = useState<TaskAiSetup | null>(null);
  const load = useOrgAction(taskAiSetupAction, { onSuccess: setSetup });
  return { setup, load: () => (setup ? undefined : void load.run({})) };
}

function useRunner() {
  const { orgSlug } = useWorkspace();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<{ message: string; alternatives: Alternative[] } | null>(null);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>(null);
  const abort = useRef<AbortController | null>(null);

  async function run(body: TaskAiRequest, selection: AiSelection, confirmCost = false): Promise<TaskAiResult | null> {
    setRunning(true);
    setError(null);
    setCostPrompt(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch("/api/tasks/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ orgSlug, ...body, selection, confirmCost }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: TaskAiResult;
        meta?: Meta;
        error?: string;
        code?: string;
        alternatives?: Alternative[];
      };
      if (res.ok && json.ok && json.result) {
        setMeta(json.meta ?? null);
        return json.result;
      }
      if (json.code === "cost_confirmation") setCostPrompt(json.error ?? "Confirme o custo para continuar.");
      else setError({ message: json.error ?? "Não foi possível gerar.", alternatives: json.alternatives ?? [] });
      return null;
    } catch (err) {
      if ((err as Error).name !== "AbortError")
        setError({ message: "Falha de conexão durante a geração.", alternatives: [] });
      return null;
    } finally {
      setRunning(false);
    }
  }

  return {
    run,
    running,
    error,
    costPrompt,
    meta,
    cancel: () => abort.current?.abort(),
    dismissCost: () => setCostPrompt(null),
    reset: () => {
      setError(null);
      setMeta(null);
      setCostPrompt(null);
    },
  };
}
type Runner = ReturnType<typeof useRunner>;

/** Avisos de política, demonstração e configuração antes de gerar. */
function AiNotice({ setup, needsContext }: { setup: Extract<TaskAiSetup, { canUse: true }>; needsContext: boolean }) {
  const { orgSlug } = useWorkspace();
  if (!setup.enabled) return <Notice tone="warning">O assistente de IA está desativado nesta organização.</Notice>;
  if (!setup.configured)
    return (
      <Notice tone="warning">
        Nenhum provedor de IA está pronto. Um administrador pode configurar em{" "}
        <Link className="underline" href={`/w/${orgSlug}/settings/ai`}>
          Configurações → Inteligência artificial
        </Link>
        .
      </Notice>
    );
  if (setup.demo)
    return (
      <Notice>
        <ShieldCheck className="size-4 shrink-0" /> Modo demonstração: a proposta é montada localmente, sem enviar nada
        a terceiros.
      </Notice>
    );
  if (needsContext && !setup.allowClientContext)
    return (
      <Notice tone="warning">
        A política da organização não permite enviar dados de tarefas e clientes ao provedor. Um administrador pode
        liberar em Configurações → Inteligência artificial.
      </Notice>
    );
  return (
    <Notice>
      <ShieldCheck className="size-4 shrink-0" />
      {needsContext
        ? "Os dados desta tarefa vão ao provedor escolhido, conforme a política da organização."
        : setup.allowClientContext
          ? "Vão ao provedor o texto digitado e o nome do projeto."
          : "Só o texto digitado vai ao provedor."}{" "}
      Nada é gravado sem a sua confirmação.
    </Notice>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone?: "warning" }) {
  return (
    <p
      className={
        tone === "warning"
          ? "flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning"
          : "flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted"
      }
    >
      {tone === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : null}
      <span className="flex min-w-0 flex-wrap items-center gap-1">{children}</span>
    </p>
  );
}

/** Seletor de modelo, confirmação de custo, erros com alternativas e o botão de gerar. */
function RunControls({
  setup,
  task,
  runner,
  selection,
  onSelection,
  onGenerate,
  disabled,
  label = "Gerar proposta",
}: {
  setup: Extract<TaskAiSetup, { canUse: true }>;
  task: AiTask;
  runner: Runner;
  selection: AiSelection;
  onSelection: (s: AiSelection) => void;
  onGenerate: (confirmCost: boolean, selection?: AiSelection) => void;
  disabled?: boolean;
  label?: string;
}) {
  const blocked = !setup.enabled || !setup.configured;
  return (
    <div className="grid gap-3">
      <AiModelPicker
        providers={setup.picker.providers}
        preferences={setup.picker.preferences}
        task={task}
        module="tasks"
        value={selection}
        onChange={onSelection}
        disabled={runner.running}
      />
      {runner.costPrompt ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 p-3 text-sm">
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /> {runner.costPrompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => onGenerate(true)}>
              Confirmar e gerar
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={runner.dismissCost}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
      {runner.error ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-3 text-sm">
          <p className="flex items-start gap-2 text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {runner.error.message}
          </p>
          {runner.error.alternatives.length ? (
            <div className="flex flex-wrap gap-1.5">
              {runner.error.alternatives.map((a) => (
                <Button
                  key={`${a.provider}:${a.model}`}
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const next: AiSelection = { mode: "manual", provider: a.provider, model: a.model };
                    onSelection(next);
                    onGenerate(false, next);
                  }}
                >
                  Usar {a.label} ({a.providerLabel})
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="accent"
          onClick={() => onGenerate(false)}
          disabled={disabled || blocked || runner.running}
          loading={runner.running}
        >
          <Wand2 /> {runner.running ? "Gerando…" : label}
        </Button>
        {runner.running ? (
          <Button type="button" variant="ghost" onClick={runner.cancel}>
            Cancelar
          </Button>
        ) : null}
        {runner.meta ? (
          <span className="text-xs text-fg-subtle">
            {runner.meta.demo ? "Demonstração" : `${runner.meta.modelLabel} · ${runner.meta.providerLabel}`}
          </span>
        ) : null}
      </div>
      {runner.meta?.warnings.length ? (
        <ul className="grid gap-1 text-xs text-warning">
          {runner.meta.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Prévia editável: plano de tarefas                                    */
/* ------------------------------------------------------------------ */

type PlanRow = PlanItem & { include: boolean; useDue: boolean; key: number };

function ListEditor({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={v}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
            maxLength={200}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remover ${label.toLowerCase()} ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="justify-self-start"
        onClick={() => onChange([...values, ""])}
      >
        <Plus /> {placeholder}
      </Button>
    </div>
  );
}

function PlanPreview({
  items,
  projects,
  members,
  defaultProjectId,
  requestId,
  onDone,
}: {
  items: PlanItem[];
  projects: ProjectOpt[];
  members: MemberOpt[];
  defaultProjectId: string | null;
  requestId: string | null;
  onDone: (created: { ids: string[]; projectId: string }) => void;
}) {
  const [rows, setRows] = useState<PlanRow[]>(() =>
    items.map((it, key) => ({
      ...it,
      key,
      include: true,
      useDue: it.dueOrigin === "texto" || it.dueOrigin === "solicitacao",
    })),
  );
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [confirming, setConfirming] = useState(false);
  const apply = useOrgAction(applyTaskPlanAction, {
    success: (d) => `${d.created} tarefa${d.created === 1 ? "" : "s"} criada${d.created === 1 ? "" : "s"}`,
    onSuccess: (d) => onDone({ ids: d.ids, projectId: d.projectId }),
  });
  const chosen = rows.filter((r) => r.include && r.title.trim());
  const clean = (l: string[]) => l.map((x) => x.trim()).filter(Boolean);
  const totals = {
    tasks: chosen.length,
    subtasks: chosen.reduce((n, r) => n + clean(r.subtasks).length, 0),
    checklist: chosen.reduce((n, r) => n + clean(r.checklist).length, 0),
  };
  const patch = (key: number, p: Partial<PlanRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="grid gap-3">
      <p className="text-xs text-fg-muted">
        Revise e ajuste antes de criar. Prazos sugeridos pela IA ficam desmarcados até você confirmar.
      </p>
      <ol className="grid gap-3">
        {rows.map((r, i) => (
          <li
            key={r.key}
            className={
              r.include
                ? "rounded-lg border border-border p-3"
                : "rounded-lg border border-dashed border-border p-3 opacity-60"
            }
          >
            <div className="flex items-start gap-2">
              <Checkbox
                className="mt-2.5"
                checked={r.include}
                onCheckedChange={(v) => patch(r.key, { include: v === true })}
                aria-label={`Incluir tarefa ${i + 1}`}
              />
              <div className="grid min-w-0 flex-1 gap-2">
                <Input
                  value={r.title}
                  onChange={(e) => patch(r.key, { title: e.target.value })}
                  aria-label={`Título da tarefa ${i + 1}`}
                  maxLength={200}
                  className="font-medium"
                />
                {r.include ? (
                  <>
                    <Textarea
                      rows={2}
                      value={r.description}
                      onChange={(e) => patch(r.key, { description: e.target.value })}
                      aria-label={`Descrição da tarefa ${i + 1}`}
                      placeholder="Descrição (opcional)"
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <NativeSelect
                        value={r.priority}
                        onChange={(e) => patch(r.key, { priority: e.target.value as Priority })}
                        aria-label={`Prioridade da tarefa ${i + 1}`}
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </NativeSelect>
                      <NativeSelect
                        value={r.assigneeMembershipId ?? ""}
                        onChange={(e) => patch(r.key, { assigneeMembershipId: e.target.value || null })}
                        aria-label={`Responsável pela tarefa ${i + 1}`}
                      >
                        <option value="">Sem responsável</option>
                        {members.map((m) => (
                          <option key={m.membershipId} value={m.membershipId}>
                            {m.name}
                          </option>
                        ))}
                      </NativeSelect>
                      <Input
                        type="date"
                        value={r.dueDate ?? ""}
                        onChange={(e) => patch(r.key, { dueDate: e.target.value || null, useDue: !!e.target.value })}
                        aria-label={`Prazo da tarefa ${i + 1}`}
                      />
                    </div>
                    {r.assigneeHint && !r.assigneeMembershipId ? (
                      <p className="text-xs text-fg-subtle">
                        A IA citou “{r.assigneeHint}”, mas não encontrou essa pessoa entre as que você pode indicar.
                      </p>
                    ) : null}
                    {r.dueDate ? (
                      <label className="flex flex-wrap items-center gap-2 text-xs">
                        <Checkbox
                          checked={r.useDue}
                          onCheckedChange={(v) => patch(r.key, { useDue: v === true })}
                          aria-label={`Usar o prazo da tarefa ${i + 1}`}
                        />
                        <span>Usar o prazo {formatDate(r.dueDate)}</span>
                        {r.dueOrigin ? (
                          <Badge tone={r.dueOrigin === "sugestao" ? "warning" : "neutral"}>
                            <CalendarClock className="size-3" /> {DUE_ORIGIN_LABEL[r.dueOrigin]}
                          </Badge>
                        ) : null}
                      </label>
                    ) : null}
                    <details
                      className="rounded-md bg-surface-2/60 px-2 py-1.5"
                      open={r.subtasks.length + r.checklist.length > 0}
                    >
                      <summary className="cursor-pointer text-xs font-medium text-fg-muted">
                        Subtarefas ({clean(r.subtasks).length}) e checklist ({clean(r.checklist).length})
                      </summary>
                      <div className="mt-2 grid gap-3">
                        <ListEditor
                          label="Subtarefa"
                          values={r.subtasks}
                          onChange={(v) => patch(r.key, { subtasks: v })}
                          placeholder="Adicionar subtarefa"
                        />
                        <ListEditor
                          label="Item do checklist"
                          values={r.checklist}
                          onChange={(v) => patch(r.key, { checklist: v })}
                          placeholder="Adicionar item"
                        />
                      </div>
                    </details>
                  </>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="sticky -bottom-4 -mb-4 grid gap-2 border-t border-border bg-surface pt-3 pb-4">
        <Field
          label="Projeto onde as tarefas serão criadas"
          htmlFor="ai-plan-project"
          error={apply.fieldErrors.projectId}
        >
          <NativeSelect id="ai-plan-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Escolha o projeto…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} · {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {confirming ? (
          <div role="alert" className="grid gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
            <p>
              Serão criadas <strong>{totals.tasks}</strong> tarefa{totals.tasks === 1 ? "" : "s"}
              {totals.subtasks ? `, ${totals.subtasks} subtarefa${totals.subtasks === 1 ? "" : "s"}` : ""}
              {totals.checklist
                ? ` e ${totals.checklist} ite${totals.checklist === 1 ? "m" : "ns"} de checklist`
                : ""}{" "}
              em <strong>{project ? `${project.clientName} · ${project.name}` : "—"}</strong>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="primary"
                loading={apply.pending}
                onClick={() =>
                  apply.run({
                    projectId,
                    requestId,
                    tasks: chosen.map((r) => ({
                      title: r.title.trim(),
                      description: r.description.trim(),
                      priority: r.priority,
                      dueDate: r.useDue ? r.dueDate : null,
                      assigneeMembershipId: r.assigneeMembershipId,
                      estimateMinutes: r.estimateMinutes,
                      subtasks: clean(r.subtasks),
                      checklist: clean(r.checklist),
                    })),
                  })
                }
              >
                Confirmar criação
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={apply.pending}>
                Voltar e editar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            className="justify-self-start"
            disabled={!projectId || !chosen.length}
            onClick={() => setConfirming(true)}
          >
            Revisar e criar {chosen.length} tarefa{chosen.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pendências (sem IA)                                                  */
/* ------------------------------------------------------------------ */

function HealthPanel({ health, basePath }: { health: TaskAiSetup["health"]; basePath: string }) {
  const { orgSlug } = useWorkspace();
  const groups = [
    {
      key: "unassigned",
      title: "Sem responsável",
      data: health.unassigned,
      href: `${basePath}?view=list&assignee=none&open=1`,
    },
    { key: "undated", title: "Sem prazo", data: health.undated, href: `${basePath}?view=list&due=none&open=1` },
    { key: "blocked", title: "Bloqueadas", data: health.blocked, href: `${basePath}?view=list&blocked=1` },
  ] as const;
  return (
    <div className="grid gap-4">
      <p className="text-xs text-fg-muted">
        Levantamento feito na própria plataforma, sem IA: tarefas abertas que você pode ver.
      </p>
      {groups.map((g) => (
        <section key={g.key} className="grid gap-1.5">
          <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
            <span>
              {g.title} <span className="font-normal text-fg-subtle">{g.data.total}</span>
            </span>
            {g.data.total ? (
              <Link href={g.href} className="text-xs font-normal text-accent-text hover:underline">
                Ver todas
              </Link>
            ) : null}
          </h3>
          {g.data.rows.length ? (
            <ul className="grid gap-1">
              {g.data.rows.map((r) => (
                <li key={r.id} className="rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <Link href={`/w/${orgSlug}/tasks/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <span className="block truncate text-xs text-fg-subtle">
                    {r.clientName} · {r.projectName}
                    {r.dueDate ? ` · prazo ${formatDate(r.dueDate)}` : ""}
                  </span>
                  {g.key === "blocked" && r.blockers ? (
                    <span className="block text-xs text-warning">Aguardando: {r.blockers}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-subtle">Nada por aqui.</p>
          )}
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assistente da Central (criar a partir de texto, converter, pendências) */
/* ------------------------------------------------------------------ */

export function TaskAiAssistant({
  projects,
  members,
  basePath,
  defaultProjectId = null,
  initialRequestId = null,
  canWrite,
  canAssign,
}: {
  projects: ProjectOpt[];
  members: MemberOpt[];
  basePath: string;
  defaultProjectId?: string | null;
  initialRequestId?: string | null;
  canWrite: boolean;
  canAssign: boolean;
}) {
  const router = useRouter();
  const ws = useWorkspace();
  const [open, setOpen] = useState(!!initialRequestId);
  const { setup, load } = useSetup();
  const runner = useRunner();
  const [tab, setTab] = useState(initialRequestId ? "demand" : canWrite ? "plan" : "health");
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [requestId, setRequestId] = useState(initialRequestId ?? "");
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [result, setResult] = useState<Extract<TaskAiResult, { mode: "plan" | "demand" }> | null>(null);
  const assignable = canAssign ? members : members.filter((m) => m.membershipId === ws.membershipId);

  // Aberto por link (?assistente=solicitacao): carrega os dados uma vez ao montar.
  useEffect(() => {
    if (initialRequestId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(confirmCost: boolean, sel = selection) {
    const body: TaskAiRequest =
      tab === "demand" ? { mode: "demand", requestId } : { mode: "plan", text, projectId: projectId || null };
    const r = await runner.run(body, sel, confirmCost);
    if (r && (r.mode === "plan" || r.mode === "demand")) setResult(r);
  }

  const ai = setup?.canUse ? setup : null;
  const requestOpts = ai?.requests ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setResult(null);
          runner.reset();
        }
      }}
    >
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        <Sparkles /> Assistente
      </Button>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Assistente de tarefas</DialogTitle>
          <DialogDescription>
            A IA propõe; você revisa, ajusta e confirma. Nada é criado sem a sua confirmação.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!setup ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v);
                setResult(null);
                runner.reset();
              }}
            >
              <TabsList className="mb-4 flex-wrap">
                {ai && canWrite ? (
                  <TabsTrigger value="plan">
                    <Wand2 /> Criar com IA
                  </TabsTrigger>
                ) : null}
                {ai && canWrite && requestOpts.length ? (
                  <TabsTrigger value="demand">
                    <MessageSquareText /> Converter solicitação
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="health">
                  <ListChecks /> Pendências
                </TabsTrigger>
              </TabsList>

              {ai ? (
                <>
                  <TabsContent value="plan" className="grid gap-4">
                    {result ? (
                      <PlanPreview
                        items={result.items}
                        projects={projects}
                        members={assignable}
                        defaultProjectId={projectId || null}
                        requestId={null}
                        onDone={() => {
                          setOpen(false);
                          setResult(null);
                          setText("");
                          router.refresh();
                        }}
                      />
                    ) : (
                      <>
                        <AiNotice setup={ai} needsContext={false} />
                        <Field label="O que precisa ser feito?" htmlFor="ai-plan-text">
                          <Textarea
                            id="ai-plan-text"
                            rows={5}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            maxLength={6000}
                            placeholder={
                              "Ex.: Campanha de Natal da padaria: 3 posts no feed até 10/12, reels com a Helena e stories de contagem regressiva. Aprovação do cliente antes de publicar."
                            }
                          />
                        </Field>
                        <Field label="Projeto (opcional agora, obrigatório para criar)" htmlFor="ai-plan-project-pre">
                          <NativeSelect
                            id="ai-plan-project-pre"
                            value={projectId}
                            onChange={(e) => setProjectId(e.target.value)}
                          >
                            <option value="">Escolher depois</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.clientName} · {p.name}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <RunControls
                          setup={ai}
                          task={TASK_AI_MODES.plan.task}
                          runner={runner}
                          selection={selection}
                          onSelection={setSelection}
                          onGenerate={generate}
                          disabled={text.trim().length < 3}
                        />
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="demand" className="grid gap-4">
                    {result ? (
                      <PlanPreview
                        items={result.items}
                        projects={projects}
                        members={assignable}
                        defaultProjectId={result.projectId}
                        requestId={result.requestId}
                        onDone={() => {
                          setOpen(false);
                          setResult(null);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <>
                        <AiNotice setup={ai} needsContext />
                        <Field label="Solicitação" htmlFor="ai-demand-request">
                          <NativeSelect
                            id="ai-demand-request"
                            value={requestId}
                            onChange={(e) => setRequestId(e.target.value)}
                          >
                            <option value="">Escolha a solicitação…</option>
                            {requestOpts.map((r) => (
                              <option key={r.id} value={r.id}>
                                #{r.number} · {r.clientName} · {r.title}
                              </option>
                            ))}
                          </NativeSelect>
                        </Field>
                        <p className="text-xs text-fg-muted">
                          As tarefas ficam vinculadas à solicitação; se ela ainda não tiver projeto, passa a “Em
                          produção” no projeto escolhido.
                        </p>
                        <RunControls
                          setup={ai}
                          task={TASK_AI_MODES.demand.task}
                          runner={runner}
                          selection={selection}
                          onSelection={setSelection}
                          onGenerate={generate}
                          disabled={!requestId || (!ai.demo && !ai.allowClientContext)}
                        />
                      </>
                    )}
                  </TabsContent>
                </>
              ) : null}

              <TabsContent value="health">
                {!setup.canUse ? (
                  <p className="mb-3 text-xs text-fg-muted">
                    Seu papel não inclui o uso de IA; as pendências estão abaixo.
                  </p>
                ) : null}
                <HealthPanel health={setup.health} basePath={basePath} />
              </TabsContent>
            </Tabs>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* IA na tarefa: quebrar, sugerir prioridade/prazo, resumir comentários */
/* ------------------------------------------------------------------ */

type TaskMode = "breakdown" | "triage" | "summary";

export function TaskAiMenu({ taskId, isSubtask, canWrite }: { taskId: string; isSubtask: boolean; canWrite: boolean }) {
  const [mode, setMode] = useState<TaskMode | null>(null);
  const { setup, load } = useSetup();
  const choose = (m: TaskMode) => {
    setMode(m);
    load();
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" aria-label="Assistente de IA da tarefa">
            <Sparkles /> IA
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {canWrite ? (
            <>
              <DropdownMenuItem onSelect={() => choose("breakdown")}>
                <ListChecks /> {isSubtask ? "Sugerir checklist" : "Quebrar em subtarefas"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => choose("triage")}>
                <CalendarClock /> Sugerir prioridade e prazo
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => choose("summary")}>
            <MessageSquareText /> Resumir comentários
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode ? <TaskAiDialog taskId={taskId} mode={mode} setup={setup} onClose={() => setMode(null)} /> : null}
    </>
  );
}

function TaskAiDialog({
  taskId,
  mode,
  setup,
  onClose,
}: {
  taskId: string;
  mode: TaskMode;
  setup: TaskAiSetup | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const runner = useRunner();
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<TaskAiResult | null>(null);
  const ai = setup?.canUse ? setup : null;
  const def = TASK_AI_MODES[mode];

  async function generate(confirmCost: boolean, sel = selection) {
    const body: TaskAiRequest = mode === "breakdown" ? { mode, taskId, notes } : { mode, taskId };
    const r = await runner.run(body, sel, confirmCost);
    if (r) setResult(r);
  }
  const done = () => {
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{def.label}</DialogTitle>
          <DialogDescription>A IA propõe; você revisa e confirma antes de qualquer alteração.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {!setup ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !ai ? (
            <p className="text-sm text-fg-muted">Seu papel não inclui o uso de IA.</p>
          ) : result?.mode === "breakdown" ? (
            <BreakdownPreview result={result} onDone={done} />
          ) : result?.mode === "triage" ? (
            <TriagePreview result={result} onDone={done} />
          ) : result?.mode === "summary" ? (
            <SummaryPreview result={result} onDone={done} />
          ) : (
            <>
              <AiNotice setup={ai} needsContext />
              {mode === "breakdown" ? (
                <Field label="Observações (opcional)" htmlFor="ai-breakdown-notes">
                  <Textarea
                    id="ai-breakdown-notes"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={2000}
                    placeholder="Ex.: incluir revisão do cliente; entregar em 2 formatos"
                  />
                </Field>
              ) : null}
              <RunControls
                setup={ai}
                task={def.task}
                runner={runner}
                selection={selection}
                onSelection={setSelection}
                onGenerate={generate}
                disabled={!ai.demo && !ai.allowClientContext}
                label={mode === "summary" ? "Gerar resumo" : "Gerar sugestão"}
              />
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function BreakdownPreview({
  result,
  onDone,
}: {
  result: Extract<TaskAiResult, { mode: "breakdown" }>;
  onDone: () => void;
}) {
  const [subs, setSubs] = useState(result.subtasks.map((s) => ({ ...s, include: true })));
  const [items, setItems] = useState(result.checklist.map((title) => ({ title, include: true })));
  const [confirming, setConfirming] = useState(false);
  const apply = useOrgAction(applyTaskBreakdownAction, { success: "Adicionado à tarefa", onSuccess: onDone });
  const chosenSubs = subs.filter((s) => s.include && s.title.trim());
  const chosenItems = items.filter((s) => s.include && s.title.trim());
  return (
    <div className="grid gap-4">
      {subs.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-sm font-semibold">Subtarefas</h3>
          {subs.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                checked={s.include}
                onCheckedChange={(v) => setSubs((l) => l.map((x, j) => (j === i ? { ...x, include: v === true } : x)))}
                aria-label={`Incluir subtarefa ${i + 1}`}
              />
              <Input
                value={s.title}
                maxLength={200}
                aria-label={`Subtarefa ${i + 1}`}
                onChange={(e) => setSubs((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
            </div>
          ))}
        </section>
      ) : null}
      {items.length ? (
        <section className="grid gap-1.5">
          <h3 className="text-sm font-semibold">Checklist</h3>
          {items.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Checkbox
                checked={s.include}
                onCheckedChange={(v) => setItems((l) => l.map((x, j) => (j === i ? { ...x, include: v === true } : x)))}
                aria-label={`Incluir item ${i + 1}`}
              />
              <Input
                value={s.title}
                maxLength={200}
                aria-label={`Item ${i + 1}`}
                onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
            </div>
          ))}
        </section>
      ) : null}
      {confirming ? (
        <div role="alert" className="grid gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm">
          <p>
            Adicionar {chosenSubs.length} subtarefa{chosenSubs.length === 1 ? "" : "s"} e {chosenItems.length} ite
            {chosenItems.length === 1 ? "m" : "ns"} de checklist a esta tarefa?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={apply.pending}
              onClick={() =>
                apply.run({
                  taskId: result.taskId,
                  subtasks: chosenSubs.map((s) => ({ title: s.title.trim(), estimateMinutes: s.estimateMinutes })),
                  checklist: chosenItems.map((s) => s.title.trim()),
                })
              }
            >
              Confirmar
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={apply.pending}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          className="justify-self-start"
          disabled={!chosenSubs.length && !chosenItems.length}
          onClick={() => setConfirming(true)}
        >
          Revisar e adicionar
        </Button>
      )}
    </div>
  );
}

function TriagePreview({ result, onDone }: { result: Extract<TaskAiResult, { mode: "triage" }>; onDone: () => void }) {
  const changed = result.priority !== result.current.priority;
  const [usePriority, setUsePriority] = useState(changed);
  const [useDue, setUseDue] = useState(false);
  const [due, setDue] = useState(result.dueDate ?? "");
  const update = useOrgAction(updateTaskAction, { success: "Tarefa atualizada", onSuccess: onDone });
  return (
    <div className="grid gap-4 text-sm">
      <section className="grid gap-1.5 rounded-lg border border-border p-3">
        <label className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={usePriority}
            onCheckedChange={(v) => setUsePriority(v === true)}
            disabled={!changed}
            aria-label="Aplicar a prioridade sugerida"
          />
          <span className="font-medium">Prioridade:</span>
          <PriorityLabel priority={result.current.priority} />
          {changed ? (
            <>
              <span className="text-fg-subtle">→</span>
              <PriorityLabel priority={result.priority} />
            </>
          ) : (
            <span className="text-xs text-fg-subtle">(sem mudança sugerida)</span>
          )}
        </label>
        {result.priorityReason ? <p className="text-xs text-fg-muted">{result.priorityReason}</p> : null}
      </section>
      <section className="grid gap-1.5 rounded-lg border border-border p-3">
        <p>
          <span className="font-medium">Prazo atual:</span>{" "}
          {result.current.dueDate ? formatDate(result.current.dueDate) : "sem prazo"}
        </p>
        {result.dueDate ? (
          <>
            <label className="flex flex-wrap items-center gap-2">
              <Checkbox
                checked={useDue}
                onCheckedChange={(v) => setUseDue(v === true)}
                aria-label="Aplicar o prazo sugerido"
              />
              <span>Usar o prazo sugerido</span>
              <Input
                type="date"
                className="w-auto"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Prazo sugerido"
              />
            </label>
            <Badge tone="warning" className="justify-self-start">
              <CalendarClock className="size-3" /> {DUE_ORIGIN_LABEL.sugestao}
            </Badge>
          </>
        ) : (
          <p className="text-xs text-fg-subtle">Nenhum prazo sugerido.</p>
        )}
        {result.dueReason ? <p className="text-xs text-fg-muted">{result.dueReason}</p> : null}
      </section>
      <Button
        variant="primary"
        className="justify-self-start"
        disabled={!(usePriority && changed) && !(useDue && due)}
        loading={update.pending}
        onClick={() =>
          update.run({
            id: result.taskId,
            ...(usePriority && changed ? { priority: result.priority } : {}),
            ...(useDue && due ? { dueDate: due } : {}),
          })
        }
      >
        Aplicar o que foi marcado
      </Button>
    </div>
  );
}

function SummaryPreview({
  result,
  onDone,
}: {
  result: Extract<TaskAiResult, { mode: "summary" }>;
  onDone: () => void;
}) {
  const body = [
    `Resumo dos comentários (assistente de IA, ${result.commentCount} comentário${result.commentCount === 1 ? "" : "s"}):`,
    result.summary,
    result.decisions.length ? `\nDecisões:\n${result.decisions.map((d) => `• ${d}`).join("\n")}` : "",
    result.pending.length ? `\nPendências:\n${result.pending.map((d) => `• ${d}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const [text, setText] = useState(body);
  const [confirming, setConfirming] = useState(false);
  const post = useOrgAction(addCommentAction, {
    success: "Resumo publicado como comentário interno",
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-3 text-sm">
      <p>{result.summary}</p>
      {result.decisions.length ? (
        <section>
          <h3 className="text-xs font-semibold text-fg-muted">Decisões</h3>
          <ul className="list-disc pl-5">
            {result.decisions.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {result.pending.length ? (
        <section>
          <h3 className="text-xs font-semibold text-fg-muted">Pendências</h3>
          <ul className="list-disc pl-5">
            {result.pending.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <details>
        <summary className="cursor-pointer text-xs font-medium text-fg-muted">Publicar como comentário interno</summary>
        <div className="mt-2 grid gap-2">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto do resumo" />
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">Publicar para a equipe (o cliente não vê)?</span>
              <Button
                size="sm"
                variant="primary"
                loading={post.pending}
                onClick={() =>
                  post.run({ target: { taskId: result.taskId }, body: text, internal: true, mentions: [] })
                }
              >
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="justify-self-start"
              disabled={!text.trim()}
              onClick={() => setConfirming(true)}
            >
              Publicar resumo
            </Button>
          )}
        </div>
      </details>
      <Button
        size="sm"
        variant="ghost"
        className="justify-self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => toast.success("Resumo copiado"));
        }}
      >
        Copiar resumo
      </Button>
    </div>
  );
}

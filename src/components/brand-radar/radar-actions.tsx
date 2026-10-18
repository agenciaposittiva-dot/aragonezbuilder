"use client";

import {
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Columns2,
  ExternalLink,
  ImagePlus,
  Pencil,
  Send,
  Star,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import {
  BIO_STYLES,
  countChars,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_STATUS,
  type BioStyle,
} from "@/lib/brand-radar";
import { CONTENT_FORMATS, type ContentFormat } from "@/lib/content";
import { cn } from "@/lib/utils";
import {
  bioToTaskAction,
  chooseBioVersionAction,
  contentIdeaToContentAction,
  highlightToDesignAction,
  highlightToTaskAction,
  recommendationToContentAction,
  recommendationToDesignAction,
  recommendationToTaskAction,
  saveBioVersionAction,
  sendBioForApprovalAction,
  updateRecommendationAction,
} from "@/server/actions/brand-radar";
import { CopyButton } from "./radar-forms";

type Option = { id: string; name: string };
export type RadarOptions = {
  projects: Option[];
  members: Option[];
  campaigns: Option[];
  can: { tasks: boolean; projects: boolean; designs: boolean; content: boolean; approvals: boolean };
};

const DEFAULT_PROJECT = "Implementação do Radar de Marca";

/* ------------------------------------------------------------------ */
/* Projeto da tarefa (existente ou novo)                                */
/* ------------------------------------------------------------------ */

type ProjectValue = { mode: "existing"; id: string } | { mode: "new"; name: string };

function ProjectFields({
  options,
  value,
  onChange,
  canCreate,
}: {
  options: Option[];
  value: ProjectValue;
  onChange: (v: ProjectValue) => void;
  canCreate: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Field label="Projeto da tarefa" htmlFor="radar-project">
        <NativeSelect
          id="radar-project"
          value={value.mode === "existing" ? value.id : "__new"}
          onChange={(e) =>
            onChange(
              e.target.value === "__new"
                ? { mode: "new", name: DEFAULT_PROJECT }
                : { mode: "existing", id: e.target.value },
            )
          }
        >
          {canCreate ? <option value="__new">Novo projeto…</option> : null}
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {value.mode === "new" ? (
        <Field label="Nome do novo projeto" htmlFor="radar-project-name">
          <Input
            id="radar-project-name"
            value={value.name}
            onChange={(e) => onChange({ mode: "new", name: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}

function initialProject(o: RadarOptions): ProjectValue {
  return o.can.projects || !o.projects[0]
    ? { mode: "new", name: DEFAULT_PROJECT }
    : { mode: "existing", id: o.projects[0].id };
}

function TaskDialog({
  options,
  title,
  description,
  pending,
  onSubmit,
  trigger,
}: {
  options: RadarOptions;
  title: string;
  description: string;
  pending: boolean;
  onSubmit: (project: ProjectValue) => Promise<{ ok: boolean }>;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState<ProjectValue>(initialProject(options));
  const usable = options.can.projects || options.projects.length > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {usable ? (
            <ProjectFields
              options={options.projects}
              value={project}
              onChange={setProject}
              canCreate={options.can.projects}
            />
          ) : (
            <p className="text-sm text-fg-muted">
              Este cliente não tem projetos e você não pode criar um. Peça a um gestor.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!usable}
            onClick={async () => {
              const r = await onSubmit(project);
              if (r.ok) setOpen(false);
            }}
          >
            Criar tarefa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Versões de bio                                                       */
/* ------------------------------------------------------------------ */

export type BioView = {
  id: string;
  style: BioStyle;
  text: string;
  objective: string;
  strengths: string[];
  cta: string;
  warnings: string[];
  status: string;
  fileId: string | null;
  taskId: string | null;
  createdAt: string;
};

export function BioVersions({
  profileId,
  versions,
  limit,
  current,
  options,
  canManage,
}: {
  profileId: string;
  versions: BioView[];
  limit: number;
  current: string | null;
  options: RadarOptions;
  canManage: boolean;
}) {
  const [compare, setCompare] = useState<string[]>([]);
  const shown = versions.filter((v) => compare.includes(v.id));
  return (
    <div className="grid gap-3">
      {compare.length ? (
        <div className="grid gap-2 rounded-xl border border-accent/40 bg-accent-soft/30 p-3" data-testid="bio-compare">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Comparando {shown.length + (current ? 1 : 0)} versões</span>
            <Button size="xs" variant="ghost" onClick={() => setCompare([])}>
              Fechar comparação
            </Button>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {current ? (
              <div className="grid content-start gap-1 rounded-lg border border-border bg-surface p-2.5">
                <span className="text-xs font-medium text-fg-muted">Bio atual · {countChars(current)} caracteres</span>
                <p className="text-sm whitespace-pre-line">{current}</p>
              </div>
            ) : null}
            {shown.map((v) => (
              <div key={v.id} className="grid content-start gap-1 rounded-lg border border-border bg-surface p-2.5">
                <span className="text-xs font-medium text-fg-muted">
                  {BIO_STYLES[v.style]} · {countChars(v.text)} caracteres
                </span>
                <p className="text-sm whitespace-pre-line">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ul className="grid gap-3 lg:grid-cols-2">
        {versions.map((v) => (
          <BioCard
            key={v.id}
            profileId={profileId}
            v={v}
            limit={limit}
            options={options}
            canManage={canManage}
            comparing={compare.includes(v.id)}
            onCompare={() =>
              setCompare((x) => (x.includes(v.id) ? x.filter((y) => y !== v.id) : [...x, v.id].slice(-3)))
            }
          />
        ))}
      </ul>
    </div>
  );
}

function BioCard({
  profileId,
  v,
  limit,
  options,
  canManage,
  comparing,
  onCompare,
}: {
  profileId: string;
  v: BioView;
  limit: number;
  options: RadarOptions;
  canManage: boolean;
  comparing: boolean;
  onCompare: () => void;
}) {
  const { orgSlug } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(v.text);
  const [stage, setStage] = useState<"internal" | "client">("internal");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const save = useOrgAction(saveBioVersionAction, { success: "Nova versão salva", onSuccess: () => setEditing(false) });
  const choose = useOrgAction(chooseBioVersionAction, {
    success: "Bio escolhida e gravada no cadastro do perfil (o Instagram não foi alterado)",
  });
  const approval = useOrgAction(sendBioForApprovalAction, {
    success: "Enviada para aprovação",
    onSuccess: () => setApprovalOpen(false),
  });
  const task = useOrgAction(bioToTaskAction, { success: "Tarefa de implementação criada" });
  const chars = countChars(editing ? text : v.text);
  const over = chars > limit;
  return (
    <li
      className={cn(
        "grid content-start gap-2 rounded-xl border border-border bg-surface p-3 shadow-xs",
        v.status === "chosen" && "border-success/60",
        comparing && "ring-2 ring-accent/50",
      )}
      data-testid="bio-version"
      data-style={v.style}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold">{BIO_STYLES[v.style]}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {v.status === "chosen" ? (
            <Badge tone="success">
              <Star /> Escolhida
            </Badge>
          ) : null}
          {v.status === "sent_for_approval" ? <Badge tone="info">Em aprovação</Badge> : null}
          <Badge tone={over ? "danger" : "outline"} className="tabular" data-testid="bio-count">
            {chars}/{limit}
          </Badge>
        </span>
      </div>
      {editing ? (
        <Textarea aria-label="Texto da bio" rows={5} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      ) : (
        <p className="rounded-lg bg-surface-2/60 p-2.5 text-sm whitespace-pre-line" data-testid="bio-text">
          {v.text}
        </p>
      )}
      {over ? <p className="text-xs text-danger">Passa do limite de {limit} caracteres.</p> : null}
      <dl className="grid gap-1 text-xs">
        {v.objective ? (
          <div>
            <dt className="inline font-medium text-fg-muted">Objetivo: </dt>
            <dd className="inline">{v.objective}</dd>
          </div>
        ) : null}
        {v.cta ? (
          <div>
            <dt className="inline font-medium text-fg-muted">Chamada para ação: </dt>
            <dd className="inline">{v.cta}</dd>
          </div>
        ) : null}
        {v.strengths.length ? (
          <div>
            <dt className="inline font-medium text-fg-muted">Pontos fortes: </dt>
            <dd className="inline">{v.strengths.join(" · ")}</dd>
          </div>
        ) : null}
      </dl>
      {v.warnings.length ? (
        <ul className="grid gap-0.5 text-xs text-warning">
          {v.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {editing ? (
          <>
            <Button
              size="xs"
              variant="primary"
              loading={save.pending}
              onClick={() => save.run({ id: v.id, profileId, text, objective: v.objective, cta: v.cta })}
            >
              Salvar versão
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setText(v.text);
                setEditing(false);
              }}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            {canManage ? (
              <Button size="xs" variant="secondary" onClick={() => setEditing(true)}>
                <Pencil /> Editar
              </Button>
            ) : null}
            <CopyButton text={v.text} />
            <Button
              size="xs"
              variant={comparing ? "primary" : "secondary"}
              onClick={onCompare}
              aria-pressed={comparing}
            >
              <Columns2 /> Comparar
            </Button>
          </>
        )}
      </div>
      {canManage && !editing ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
          <Button
            size="xs"
            variant={v.status === "chosen" ? "secondary" : "primary"}
            loading={choose.pending}
            onClick={() => choose.run({ id: v.id })}
            disabled={v.status === "chosen"}
          >
            <CheckCircle2 /> Usar esta versão
          </Button>
          {options.can.approvals ? (
            <Dialog open={approvalOpen} onOpenChange={setApprovalOpen}>
              <DialogTrigger asChild>
                <Button size="xs" variant="secondary">
                  <Send /> Enviar para aprovação
                </Button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Enviar a bio para aprovação</DialogTitle>
                  <DialogDescription>
                    Um arquivo de texto com a proposta vai para Arquivos do cliente e entra no fluxo de aprovações.
                    Aprovar não altera o Instagram.
                  </DialogDescription>
                </DialogHeader>
                <DialogBody>
                  <Field label="Etapa" htmlFor={`stage-${v.id}`}>
                    <NativeSelect
                      id={`stage-${v.id}`}
                      value={stage}
                      onChange={(e) => setStage(e.target.value as "internal" | "client")}
                    >
                      <option value="internal">Aprovação interna</option>
                      <option value="client">Aprovação do cliente</option>
                    </NativeSelect>
                  </Field>
                </DialogBody>
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setApprovalOpen(false)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    loading={approval.pending}
                    onClick={() => approval.run({ id: v.id, stage })}
                  >
                    Enviar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
          {options.can.tasks ? (
            <TaskDialog
              options={options}
              title="Criar tarefa de implementação"
              description="A tarefa traz o texto da bio para a equipe trocar no aplicativo do Instagram depois da aprovação."
              pending={task.pending}
              onSubmit={(project) => task.run({ id: v.id, project })}
              trigger={
                <Button size="xs" variant="secondary">
                  <ClipboardList /> Criar tarefa de implementação
                </Button>
              }
            />
          ) : null}
          {v.fileId ? (
            <Link
              href={`/w/${orgSlug}/files/${v.fileId}`}
              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
            >
              Ver aprovação <ExternalLink className="size-3" />
            </Link>
          ) : null}
          {v.taskId ? (
            <Link
              href={`/w/${orgSlug}/tasks/${v.taskId}`}
              className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
            >
              Ver tarefa <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Destaques recomendados                                               */
/* ------------------------------------------------------------------ */

export function HighlightActions({
  diagnosisId,
  index,
  options,
}: {
  diagnosisId: string;
  index: number;
  options: RadarOptions;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const open = (r: { designId: string }) => router.push(`/w/${orgSlug}/studio/${r.designId}`);
  const cover = useOrgAction(highlightToDesignAction, { success: "Capa criada no editor", onSuccess: open });
  const stories = useOrgAction(highlightToDesignAction, { success: "Stories criados no editor", onSuccess: open });
  const task = useOrgAction(highlightToTaskAction, { success: "Tarefa criada" });
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.can.designs ? (
        <>
          <Button
            size="xs"
            variant="secondary"
            loading={cover.pending}
            onClick={() => cover.run({ diagnosisId, index, kind: "cover" })}
          >
            <ImagePlus /> Criar capa no editor
          </Button>
          <Button
            size="xs"
            variant="secondary"
            loading={stories.pending}
            onClick={() => stories.run({ diagnosisId, index, kind: "stories" })}
          >
            <ImagePlus /> Criar Stories no editor
          </Button>
        </>
      ) : null}
      {options.can.tasks ? (
        <TaskDialog
          options={options}
          title="Criar tarefa do destaque"
          description="A tarefa leva o objetivo, a ordem, as ideias de Stories e a direção da capa."
          pending={task.pending}
          onSubmit={(project) => task.run({ diagnosisId, index, project })}
          trigger={
            <Button size="xs" variant="secondary">
              <ClipboardList /> Criar tarefa
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cartões de recomendação                                              */
/* ------------------------------------------------------------------ */

export type RecommendationView = {
  id: string;
  status: keyof typeof RECOMMENDATION_STATUS;
  category: keyof typeof RECOMMENDATION_CATEGORIES;
  priority: number;
  assigneeMembershipId: string | null;
  dueDate: string | null;
  taskId: string | null;
  designId: string | null;
  contentItemId: string | null;
};

const DESIGN_FORMATS = {
  feed: "Arte para o feed",
  carousel: "Carrossel",
  stories: "Sequência de Stories",
  highlight_cover: "Capa de destaque",
} as const;

export function RecommendationControls({
  rec,
  options,
  canManage,
}: {
  rec: RecommendationView;
  options: RadarOptions;
  canManage: boolean;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const update = useOrgAction(updateRecommendationAction, { success: "Recomendação atualizada" });
  const task = useOrgAction(recommendationToTaskAction, {
    success: (r) => (r.existed ? "Esta recomendação já tem tarefa" : "Tarefa criada"),
  });
  const design = useOrgAction(recommendationToDesignAction, {
    success: "Arte criada no editor",
    onSuccess: (r) => router.push(`/w/${orgSlug}/studio/${r.designId}`),
  });
  const [contentOpen, setContentOpen] = useState(false);
  const [format, setFormat] = useState<ContentFormat>("feed");
  const [campaign, setCampaign] = useState<string>("none");
  const [campaignName, setCampaignName] = useState("");
  const content = useOrgAction(recommendationToContentAction, {
    success: (r) => `Conteúdo criado (${r.format})${r.campaignId ? " na campanha" : ""}`,
    onSuccess: () => setContentOpen(false),
  });
  const base = `/w/${orgSlug}`;
  return (
    <div className="grid gap-2">
      {canManage ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Situação" htmlFor={`st-${rec.id}`}>
            <NativeSelect
              id={`st-${rec.id}`}
              value={rec.status}
              disabled={update.pending}
              onChange={(e) => update.run({ id: rec.id, status: e.target.value as RecommendationView["status"] })}
            >
              {Object.entries(RECOMMENDATION_STATUS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Prioridade" htmlFor={`pr-${rec.id}`}>
            <NativeSelect
              id={`pr-${rec.id}`}
              value={String(rec.priority)}
              disabled={update.pending}
              onChange={(e) => update.run({ id: rec.id, priority: Number(e.target.value) })}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 1 ? " (mais urgente)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Responsável" htmlFor={`as-${rec.id}`}>
            <NativeSelect
              id={`as-${rec.id}`}
              value={rec.assigneeMembershipId ?? ""}
              disabled={update.pending}
              onChange={(e) => update.run({ id: rec.id, assigneeMembershipId: e.target.value || null })}
            >
              <option value="">Sem responsável</option>
              {options.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Prazo" htmlFor={`due-${rec.id}`}>
            <Input
              id={`due-${rec.id}`}
              type="date"
              defaultValue={rec.dueDate ?? ""}
              disabled={update.pending}
              onBlur={(e) => {
                if ((e.target.value || null) !== rec.dueDate)
                  update.run({ id: rec.id, dueDate: e.target.value || null });
              }}
            />
          </Field>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {canManage && options.can.tasks ? (
          <TaskDialog
            options={options}
            title="Transformar em tarefa"
            description="A tarefa leva o problema, a evidência, a próxima ação e como testar."
            pending={task.pending}
            onSubmit={(project) =>
              task.run({ id: rec.id, project, assigneeMembershipId: rec.assigneeMembershipId, dueDate: rec.dueDate })
            }
            trigger={
              <Button size="xs" variant="secondary">
                <ClipboardList /> {rec.taskId ? "Tarefa criada" : "Criar tarefa"}
              </Button>
            }
          />
        ) : null}
        {canManage && options.can.designs ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary" loading={design.pending}>
                <ImagePlus /> Criar arte
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Abrir no editor como…</DropdownMenuLabel>
              {(Object.keys(DESIGN_FORMATS) as (keyof typeof DESIGN_FORMATS)[]).map((f) => (
                <DropdownMenuItem key={f} onSelect={() => design.run({ id: rec.id, format: f })}>
                  {DESIGN_FORMATS[f]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canManage && options.can.content ? (
          <Dialog open={contentOpen} onOpenChange={setContentOpen}>
            <DialogTrigger asChild>
              <Button size="xs" variant="secondary">
                <CalendarPlus /> Criar conteúdo ou campanha
              </Button>
            </DialogTrigger>
            <DialogContent size="sm">
              <DialogHeader>
                <DialogTitle>Criar conteúdo</DialogTitle>
                <DialogDescription>
                  O conteúdo entra como rascunho no calendário editorial do cliente.
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="grid gap-3">
                <Field label="Formato" htmlFor={`cf-${rec.id}`}>
                  <NativeSelect
                    id={`cf-${rec.id}`}
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ContentFormat)}
                  >
                    {(Object.keys(CONTENT_FORMATS) as ContentFormat[]).map((k) => (
                      <option key={k} value={k}>
                        {CONTENT_FORMATS[k].label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Campanha" htmlFor={`cc-${rec.id}`}>
                  <NativeSelect id={`cc-${rec.id}`} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                    <option value="none">Sem campanha</option>
                    <option value="new">Nova campanha…</option>
                    {options.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                {campaign === "new" ? (
                  <Field label="Nome da campanha" htmlFor={`cn-${rec.id}`}>
                    <Input id={`cn-${rec.id}`} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                  </Field>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setContentOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  loading={content.pending}
                  disabled={campaign === "new" && campaignName.trim().length < 2}
                  onClick={() =>
                    content.run({
                      id: rec.id,
                      format,
                      campaign:
                        campaign === "none"
                          ? { mode: "none" }
                          : campaign === "new"
                            ? { mode: "new", name: campaignName }
                            : { mode: "existing", id: campaign },
                    })
                  }
                >
                  Criar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
        {rec.taskId ? (
          <Link
            href={`${base}/tasks/${rec.taskId}`}
            className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          >
            Tarefa <ExternalLink className="size-3" />
          </Link>
        ) : null}
        {rec.designId ? (
          <Link
            href={`${base}/studio/${rec.designId}`}
            className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          >
            Arte <ExternalLink className="size-3" />
          </Link>
        ) : null}
        {rec.contentItemId ? (
          <Link
            href={`${base}/content/${rec.contentItemId}`}
            className="inline-flex items-center gap-1 text-xs text-accent-text hover:underline"
          >
            Conteúdo <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ideia de conteúdo → rascunho                                         */
/* ------------------------------------------------------------------ */

export function ContentIdeaButton({ diagnosisId, index }: { diagnosisId: string; index: number }) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const action = useOrgAction(contentIdeaToContentAction, {
    success: "Rascunho de conteúdo criado",
    onSuccess: (r) => router.push(`/w/${orgSlug}/content/${r.contentItemId}`),
  });
  return (
    <Button size="xs" variant="secondary" loading={action.pending} onClick={() => action.run({ diagnosisId, index })}>
      <CalendarPlus /> Criar conteúdo
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* Comparação entre diagnósticos                                        */
/* ------------------------------------------------------------------ */

export function CompareForm({
  base,
  options,
  a,
  b,
}: {
  base: string;
  options: { id: string; label: string }[];
  a?: string;
  b?: string;
}) {
  const router = useRouter();
  const [x, setX] = useState(a ?? options[1]?.id ?? "");
  const [y, setY] = useState(b ?? options[0]?.id ?? "");
  return (
    <form
      className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`${base}?tab=history&a=${x}&b=${y}`);
      }}
    >
      <Field label="Antes" htmlFor="cmp-a">
        <NativeSelect id="cmp-a" value={x} onChange={(e) => setX(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Depois" htmlFor="cmp-b">
        <NativeSelect id="cmp-b" value={y} onChange={(e) => setY(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="primary" size="md" disabled={!x || !y || x === y}>
        <Columns2 /> Comparar
      </Button>
    </form>
  );
}

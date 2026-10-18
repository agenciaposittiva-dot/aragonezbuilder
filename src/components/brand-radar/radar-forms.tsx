"use client";

import {
  Check,
  Copy,
  ImagePlus,
  Link2,
  Plus,
  Printer,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AiModelPicker } from "@/components/ai/ai-model-picker";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { fileUrl } from "@/components/files/file-icon";
import { useWorkspace } from "@/components/shell/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import type { AiSelection } from "@/lib/ai-select";
import {
  BRAND_AI_ACTIONS,
  BRAND_DIMENSIONS,
  countChars,
  DIMENSION_KEYS,
  POST_FORMATS,
  SCREENSHOT_KINDS,
  type BrandAiAction,
  type DimensionKey,
  type ManualInputs,
  type PostFormat,
  type ScreenshotKind,
} from "@/lib/brand-radar";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  archiveRadarProfileAction,
  createRadarProfileAction,
  disconnectInstagramAction,
  runBrandAiAction,
  saveManualInputsAction,
  syncInstagramAction,
  updateRadarProfileAction,
  updateRadarSettingsAction,
} from "@/server/actions/brand-radar";
import type { AiPickerData } from "@/server/services/ai-models";

const needsConfirm = (r: { ok: boolean; code?: string; error?: string }) =>
  !r.ok && r.code === "conflict" && /Confirme para continuar/.test(r.error ?? "");

/* ------------------------------------------------------------------ */
/* Novo perfil (do cliente ou concorrente)                              */
/* ------------------------------------------------------------------ */

export function NewProfileDialog({
  clients,
  defaultClientId,
  kind = "own",
  label,
}: {
  clients: { id: string; name: string }[];
  defaultClientId?: string;
  kind?: "own" | "competitor";
  label?: string;
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(defaultClientId ?? clients[0]?.id ?? "");
  const [handle, setHandle] = useState("");
  const [niche, setNiche] = useState("");
  const [notes, setNotes] = useState("");
  const action = useOrgAction(createRadarProfileAction, {
    success: kind === "own" ? "Perfil adicionado ao Radar" : "Concorrente adicionado",
    onSuccess: (r) => {
      setOpen(false);
      setHandle("");
      setNotes("");
      if (kind === "own") router.push(`/w/${orgSlug}/brand-radar/${r.id}`);
    },
  });
  const own = kind === "own";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={own ? "primary" : "secondary"} size="sm">
          <Plus /> {label ?? (own ? "Nova análise" : "Adicionar concorrente")}
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action.run({ clientId, handle, kind, niche: niche || null, notes: notes || null });
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>{own ? "Analisar um perfil do Instagram" : "Adicionar concorrente"}</DialogTitle>
            <DialogDescription>
              {own
                ? "Informe o @ ou o endereço do perfil e o cliente a que ele pertence. Depois você conecta a conta oficial ou preenche os dados e capturas de tela — nada é coletado do Instagram sem autorização."
                : "O concorrente entra na comparação só com o que a equipe informar (bio, observações). Não fazemos coleta automática de outros perfis."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {defaultClientId && !own ? null : (
              <Field label="Cliente" htmlFor="radar-client" required>
                <NativeSelect id="radar-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field
              label="@ ou endereço do perfil"
              htmlFor="radar-handle"
              required
              error={action.fieldErrors.handle}
              hint="Ex.: @cafe.aurora ou https://www.instagram.com/cafe.aurora/"
            >
              <Input
                id="radar-handle"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@perfil"
                autoComplete="off"
                required
              />
            </Field>
            {own ? (
              <Field label="Nicho (opcional)" htmlFor="radar-niche">
                <Input
                  id="radar-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="Ex.: cafeteria de bairro"
                />
              </Field>
            ) : (
              <Field label="Observações da equipe (opcional)" htmlFor="radar-notes">
                <Textarea id="radar-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={action.pending} disabled={!clientId || !handle.trim()}>
              {own ? "Adicionar e abrir" : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Ações de IA                                                          */
/* ------------------------------------------------------------------ */

const ACTION_TAB: Record<BrandAiAction, string> = {
  analyze: "overview",
  bio: "profile",
  highlights: "highlights",
  visual: "visual",
  niche: "niche",
  competitors: "niche",
  plan: "plan",
  reassess: "history",
};

export function RadarAiDialog({
  profileId,
  picker,
  screenshots,
  defaultAction = "analyze",
  triggerLabel,
  triggerVariant = "primary",
}: {
  profileId: string;
  picker: AiPickerData;
  screenshots: number;
  defaultAction?: BrandAiAction;
  triggerLabel?: string;
  triggerVariant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<BrandAiAction>(defaultAction);
  const [selection, setSelection] = useState<AiSelection>({ mode: "default" });
  const [useImages, setUseImages] = useState(true);
  const [costPrompt, setCostPrompt] = useState<string | null>(null);
  const action = useOrgAction(runBrandAiAction);

  async function run(confirmCost?: boolean) {
    setCostPrompt(null);
    const r = await action.run({ profileId, action: choice, selection, confirmCost, useImages });
    if (needsConfirm(r)) {
      setCostPrompt((r as { error: string }).error);
      return;
    }
    if (!r.ok) return;
    toast.success(
      `${BRAND_AI_ACTIONS[choice].label}: pronto${r.data.demo ? " (demonstração, sem análise real)" : ""} · ${r.data.provider} / ${r.data.model}`,
    );
    setOpen(false);
    router.push(`/w/${orgSlug}/brand-radar/${profileId}?tab=${ACTION_TAB[choice]}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <Sparkles /> {triggerLabel ?? "Ações de IA"}
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>O que a IA deve fazer?</DialogTitle>
          <DialogDescription>
            A IA recebe só os dados com fonte e data deste perfil. O resultado separa o que foi observado, o que é
            avaliação da IA e o que não dá para avaliar, e fica salvo no histórico.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <fieldset className="grid gap-2 sm:grid-cols-2" aria-label="Ação">
            {(Object.keys(BRAND_AI_ACTIONS) as BrandAiAction[]).map((key) => (
              <label
                key={key}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-surface-2",
                  choice === key && "border-accent bg-accent-soft/40",
                )}
              >
                <input
                  type="radio"
                  name="brand-ai-action"
                  value={key}
                  checked={choice === key}
                  onChange={() => setChoice(key)}
                  className="accent-[var(--color-accent)]"
                />
                {BRAND_AI_ACTIONS[key].label}
              </label>
            ))}
          </fieldset>
          <AiModelPicker
            providers={picker.providers}
            preferences={picker.preferences}
            task="brand_analysis"
            module="brand"
            value={selection}
            onChange={setSelection}
            disabled={action.pending}
          />
          {screenshots > 0 ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={useImages} onCheckedChange={(v) => setUseImages(v === true)} className="mt-0.5" />
              <span>
                Enviar as {screenshots} captura(s) de tela para a IA
                <span className="block text-xs text-fg-muted">
                  Só modelos que leem imagens (Claude, Gemini ou OpenAI com visão) avaliam a identidade visual. Sem
                  isso, ela aparece como “não avaliada”.
                </span>
              </span>
            </label>
          ) : (
            <p className="text-xs text-fg-muted">
              Sem capturas de tela: a identidade visual não será avaliada. Envie capturas em “Editar dados”.
            </p>
          )}
          {costPrompt ? (
            <div className="grid gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm" role="alert">
              {costPrompt}
              <div>
                <Button size="sm" variant="primary" loading={action.pending} onClick={() => run(true)}>
                  Confirmar e continuar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={action.pending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={action.pending} onClick={() => run()}>
            <Sparkles /> {BRAND_AI_ACTIONS[choice].label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Dados informados e capturas de tela                                  */
/* ------------------------------------------------------------------ */

type Shot = { fileId: string; versionId: string; kind: ScreenshotKind; name: string };

export function ManualDataDialog({
  profileId,
  clientId,
  manual,
  bioLimit,
  canUpload,
}: {
  profileId: string;
  clientId: string;
  manual: ManualInputs;
  bioLimit: number;
  canUpload: boolean;
}) {
  const { orgSlug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    displayName: manual.displayName,
    category: manual.category,
    bio: manual.bio,
    link: manual.link,
    followers: manual.followers === null ? "" : String(manual.followers),
    highlights: manual.highlights.join("\n"),
    goals: manual.goals,
    notes: manual.notes,
  });
  const [posts, setPosts] = useState<{ format: PostFormat | ""; text: string }[]>(
    manual.posts.map((p) => ({ format: p.format ?? "", text: p.text })),
  );
  const [shots, setShots] = useState<Shot[]>(manual.screenshots);
  const [uploading, setUploading] = useState(false);
  const save = useOrgAction(saveManualInputsAction, {
    success: "Dados salvos. Rode uma análise para usar os dados novos.",
    onSuccess: () => setOpen(false),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const bioChars = countChars(f.bio);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 12 - shots.length)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: envie uma imagem (PNG, JPG ou WebP).`);
          continue;
        }
        const form = new FormData();
        form.set("orgSlug", orgSlug);
        form.set("clientId", clientId);
        form.set("category", "reference");
        form.set("tags", "radar-de-marca,captura-de-tela");
        form.append("file", file, file.name);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          results?: { fileId?: string; versionId?: string; name: string }[];
        };
        const r = body.results?.[0];
        if (!res.ok || !r?.fileId || !r.versionId) {
          toast.error(body.error ?? `Falha ao enviar ${file.name}.`);
          continue;
        }
        setShots((x) => [
          ...x,
          { fileId: r.fileId!, versionId: r.versionId!, kind: x.length ? "grid" : "profile", name: file.name },
        ]);
      }
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    save.run({
      profileId,
      displayName: f.displayName,
      category: f.category,
      bio: f.bio,
      link: f.link,
      followers: f.followers.trim() === "" ? null : Number(f.followers.replace(/\D/g, "")),
      highlights: f.highlights
        .split(/\n|,/)
        .map((x) => x.trim())
        .filter(Boolean),
      posts: posts.filter((p) => p.text.trim()).map((p) => ({ format: p.format || null, text: p.text.trim() })),
      goals: f.goals,
      notes: f.notes,
      screenshots: shots.map((s) => ({ fileId: s.fileId, kind: s.kind })),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <ImagePlus /> Editar dados
        </Button>
      </DialogTrigger>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Dados do perfil (entrada manual)</DialogTitle>
          <DialogDescription>
            Preencha o que você vê no perfil e envie capturas de tela. Tudo fica marcado como “informado pela equipe”,
            com a data — números informados aqui não são tratados como métricas verificadas.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome de exibição" htmlFor="m-name">
              <Input id="m-name" value={f.displayName} onChange={set("displayName")} />
            </Field>
            <Field label="Categoria do perfil" htmlFor="m-cat" hint="Ex.: Cafeteria, Criador de conteúdo">
              <Input id="m-cat" value={f.category} onChange={set("category")} />
            </Field>
          </div>
          <Field
            label="Bio atual"
            htmlFor="m-bio"
            hint={
              <span className={cn("tabular", bioChars > bioLimit && "text-danger")}>
                {bioChars} de {bioLimit} caracteres
              </span>
            }
          >
            <Textarea id="m-bio" rows={4} value={f.bio} onChange={set("bio")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Link da bio" htmlFor="m-link">
              <Input id="m-link" value={f.link} onChange={set("link")} placeholder="https://" />
            </Field>
            <Field label="Seguidores (informado, não verificado)" htmlFor="m-followers">
              <Input id="m-followers" inputMode="numeric" value={f.followers} onChange={set("followers")} />
            </Field>
          </div>
          <Field label="Destaques atuais" htmlFor="m-highlights" hint="Um por linha, na ordem em que aparecem.">
            <Textarea id="m-highlights" rows={3} value={f.highlights} onChange={set("highlights")} />
          </Field>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Publicações recentes</span>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => setPosts((x) => [...x, { format: "", text: "" }])}
                disabled={posts.length >= 30}
              >
                <Plus /> Adicionar publicação
              </Button>
            </div>
            {posts.length ? (
              <ul className="grid gap-2">
                {posts.map((p, i) => (
                  <li key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <NativeSelect
                      aria-label={`Formato da publicação ${i + 1}`}
                      value={p.format}
                      onChange={(e) =>
                        setPosts((x) =>
                          x.map((y, j) => (j === i ? { ...y, format: e.target.value as PostFormat | "" } : y)),
                        )
                      }
                    >
                      <option value="">Formato não informado</option>
                      {(Object.keys(POST_FORMATS) as PostFormat[]).map((k) => (
                        <option key={k} value={k}>
                          {POST_FORMATS[k]}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label={`Tema ou legenda da publicação ${i + 1}`}
                      value={p.text}
                      placeholder="Tema ou legenda"
                      onChange={(e) => setPosts((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Remover publicação"
                      onClick={() => setPosts((x) => x.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">
                Sem publicações informadas: conteúdo e formatos ficam “não avaliados”.
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Capturas de tela (ficam em Arquivos do cliente)</span>
            {shots.length ? (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {shots.map((s, i) => (
                  <li key={s.fileId} className="grid gap-1 rounded-lg border border-border p-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fileUrl(s.versionId, { thumb: true })}
                      alt={s.name}
                      className="aspect-square w-full rounded object-cover"
                    />
                    <NativeSelect
                      aria-label={`Tipo da captura ${s.name}`}
                      value={s.kind}
                      onChange={(e) =>
                        setShots((x) =>
                          x.map((y, j) => (j === i ? { ...y, kind: e.target.value as ScreenshotKind } : y)),
                        )
                      }
                    >
                      {(Object.keys(SCREENSHOT_KINDS) as ScreenshotKind[]).map((k) => (
                        <option key={k} value={k}>
                          {SCREENSHOT_KINDS[k]}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      type="button"
                      size="xs"
                      variant="danger-ghost"
                      onClick={() => setShots((x) => x.filter((_, j) => j !== i))}
                    >
                      <Trash2 /> Tirar da análise
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {canUpload ? (
              <label
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-fg-muted hover:bg-surface-2",
                  (uploading || shots.length >= 12) && "pointer-events-none opacity-60",
                )}
              >
                <ImagePlus className="size-4" />{" "}
                {uploading ? "Enviando…" : "Enviar capturas (perfil, grade, destaques, métricas)"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="sr-only"
                  data-testid="radar-screenshot-input"
                  onChange={(e) => {
                    void upload(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <p className="text-xs text-fg-muted">Você não tem permissão para enviar arquivos.</p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Objetivos do perfil" htmlFor="m-goals">
              <Textarea id="m-goals" rows={3} value={f.goals} onChange={set("goals")} />
            </Field>
            <Field label="Observações da equipe" htmlFor="m-notes">
              <Textarea id="m-notes" rows={3} value={f.notes} onChange={set("notes")} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.pending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.pending} disabled={uploading} onClick={submit}>
            Salvar dados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Conexão oficial com o Instagram                                      */
/* ------------------------------------------------------------------ */

export type ConnectionView = {
  configured: boolean;
  status: "not_configured" | "disconnected" | "connected" | "expired" | "revoked" | "error";
  username?: string;
  tokenExpiresAt?: Date | string | null;
  lastSyncAt?: Date | string | null;
  lastError?: string | null;
};

const CONNECTION_LABEL: Record<
  ConnectionView["status"],
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  not_configured: { label: "Integração não configurada", tone: "neutral" },
  disconnected: { label: "Não conectada", tone: "neutral" },
  connected: { label: "Conectada", tone: "success" },
  expired: { label: "Autorização vencida", tone: "warning" },
  revoked: { label: "Autorização revogada", tone: "warning" },
  error: { label: "Erro na conexão", tone: "danger" },
};

export function ConnectionPanel({
  profileId,
  state,
  canManage,
}: {
  profileId: string;
  state: ConnectionView;
  canManage: boolean;
}) {
  const { orgSlug } = useWorkspace();
  const sync = useOrgAction(syncInstagramAction, {
    success: (r) => `Dados atualizados: ${r.posts} publicação(ões) lidas.`,
  });
  const disconnect = useOrgAction(disconnectInstagramAction, { success: "Conta desconectada e autorização apagada" });
  const s = CONNECTION_LABEL[state.status];
  const connectHref = `/api/brand-radar/instagram/connect?org=${encodeURIComponent(orgSlug)}&profile=${profileId}`;
  return (
    <div className="grid gap-2 text-sm" data-testid="instagram-connection" data-status={state.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.tone}>{s.label}</Badge>
        {state.username ? <span className="text-fg-muted">@{state.username}</span> : null}
      </div>
      {state.status === "not_configured" ? (
        <p className="text-xs text-fg-muted">
          A conexão oficial (API da Meta) ainda não foi configurada neste servidor. Use a entrada manual com capturas de
          tela. O administrador configura em META_APP_ID e META_APP_SECRET.
        </p>
      ) : state.status === "disconnected" ? (
        <p className="text-xs text-fg-muted">
          Conecte a conta profissional (comercial ou de criador) para usar métricas reais. Você entra no próprio
          Instagram — nunca pedimos senha — e a conexão só lê dados.
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-fg-muted">Última leitura</dt>
          <dd>{state.lastSyncAt ? formatDateTime(state.lastSyncAt) : "—"}</dd>
          <dt className="text-fg-muted">Autorização válida até</dt>
          <dd>{state.tokenExpiresAt ? formatDateTime(state.tokenExpiresAt) : "—"}</dd>
          {state.lastError ? (
            <>
              <dt className="text-fg-muted">Aviso</dt>
              <dd className="text-warning">{state.lastError}</dd>
            </>
          ) : null}
        </dl>
      )}
      {canManage && state.configured ? (
        <div className="flex flex-wrap gap-2">
          {state.status === "connected" ? (
            <Button size="xs" variant="secondary" loading={sync.pending} onClick={() => sync.run({ profileId })}>
              <RefreshCw /> Atualizar dados
            </Button>
          ) : (
            <Button size="xs" variant="primary" asChild>
              <a href={connectHref}>
                <Link2 /> {state.status === "disconnected" ? "Conectar conta oficial" : "Conectar de novo"}
              </a>
            </Button>
          )}
          {state.status !== "disconnected" ? (
            <ConfirmDialog
              title="Desconectar a conta?"
              description="O token guardado é apagado. Os diagnósticos já feitos continuam no histórico. Para revogar também no Instagram: Configurações → Apps e sites."
              confirmLabel="Desconectar"
              onConfirm={() => disconnect.run({ profileId })}
              trigger={
                <Button size="xs" variant="danger-ghost">
                  <Unplug /> Desconectar
                </Button>
              }
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nicho, concorrentes e perfil                                         */
/* ------------------------------------------------------------------ */

export function NicheForm({
  profileId,
  values,
}: {
  profileId: string;
  values: { niche: string | null; market: string | null; region: string | null };
}) {
  const [f, setF] = useState({ niche: values.niche ?? "", market: values.market ?? "", region: values.region ?? "" });
  const save = useOrgAction(updateRadarProfileAction, { success: "Nicho salvo" });
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.run({ id: profileId, ...f });
      }}
    >
      <Field label="Nicho" htmlFor="n-niche">
        <Input id="n-niche" value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} />
      </Field>
      <Field label="Mercado" htmlFor="n-market">
        <Input id="n-market" value={f.market} onChange={(e) => setF({ ...f, market: e.target.value })} />
      </Field>
      <Field label="Região" htmlFor="n-region">
        <Input id="n-region" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} />
      </Field>
      <div className="sm:col-span-3">
        <Button type="submit" size="sm" variant="secondary" loading={save.pending}>
          Salvar nicho
        </Button>
      </div>
    </form>
  );
}

export function CompetitorNotes({ id, notes }: { id: string; notes: string | null }) {
  const [v, setV] = useState(notes ?? "");
  const save = useOrgAction(updateRadarProfileAction, { success: "Observações salvas" });
  return (
    <div className="grid gap-1.5">
      <Textarea
        aria-label="Observações sobre o concorrente"
        rows={2}
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <div>
        <Button size="xs" variant="secondary" loading={save.pending} onClick={() => save.run({ id, notes: v })}>
          Salvar observações
        </Button>
      </div>
    </div>
  );
}

export function ArchiveProfileButton({
  id,
  label = "Remover do Radar",
  redirectTo,
  description,
}: {
  id: string;
  label?: string;
  redirectTo?: string;
  description?: string;
}) {
  const router = useRouter();
  const action = useOrgAction(archiveRadarProfileAction, {
    success: "Removido do Radar",
    onSuccess: () => (redirectTo ? router.push(redirectTo) : undefined),
  });
  return (
    <ConfirmDialog
      title={`${label}?`}
      description={description ?? "Os diagnósticos ficam guardados e voltam se o perfil for adicionado de novo."}
      confirmLabel={label}
      onConfirm={() => action.run({ id })}
      trigger={
        <Button size="xs" variant="danger-ghost">
          <Trash2 /> {label}
        </Button>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Metodologia (pesos e limite da bio)                                  */
/* ------------------------------------------------------------------ */

export function RadarSettingsDialog({
  settings,
}: {
  settings: { bioLimit: number; weights: Record<DimensionKey, number> };
}) {
  const [open, setOpen] = useState(false);
  const [bioLimit, setBioLimit] = useState(String(settings.bioLimit));
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(DIMENSION_KEYS.map((k) => [k, String(settings.weights[k])])),
  );
  const save = useOrgAction(updateRadarSettingsAction, {
    success: "Metodologia atualizada",
    onSuccess: () => setOpen(false),
  });
  const total = DIMENSION_KEYS.reduce((n, k) => n + (Number(weights[k]) || 0), 0);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Settings2 /> Pesos e limites
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Metodologia da nota</DialogTitle>
          <DialogDescription>
            A nota é a média ponderada só das dimensões avaliadas. Peso zero tira a dimensão da conta. Diagnósticos
            antigos guardam os pesos que usaram; a comparação avisa quando eles mudam.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <Field
            label="Limite de caracteres da bio"
            htmlFor="s-bio"
            hint="O limite atual do Instagram é de 150 caracteres."
          >
            <Input id="s-bio" inputMode="numeric" value={bioLimit} onChange={(e) => setBioLimit(e.target.value)} />
          </Field>
          <ul className="grid gap-2">
            {DIMENSION_KEYS.map((k) => (
              <li key={k} className="grid grid-cols-[1fr_5rem] items-center gap-3">
                <label htmlFor={`w-${k}`} className="text-sm">
                  {BRAND_DIMENSIONS[k].label}
                  <span className="block text-xs text-fg-muted">{BRAND_DIMENSIONS[k].criteria}</span>
                </label>
                <Input
                  id={`w-${k}`}
                  inputMode="numeric"
                  value={weights[k]}
                  onChange={(e) => setWeights((x) => ({ ...x, [k]: e.target.value }))}
                />
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">Soma dos pesos: {total}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={save.pending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={save.pending}
            onClick={() =>
              save.run({
                bioLimit: Number(bioLimit),
                weights: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, Number(weights[k]) || 0])),
              })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                          */
/* ------------------------------------------------------------------ */

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="xs"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          toast.success("Copiado");
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
        }
      }}
    >
      {done ? <Check /> : <Copy />} {label}
    </Button>
  );
}

export function PrintButton() {
  return (
    <Button size="sm" variant="primary" onClick={() => window.print()} className="print:hidden">
      <Printer /> Imprimir ou salvar em PDF
    </Button>
  );
}

export function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-medium text-accent-text hover:underline">
      {children}
    </Link>
  );
}

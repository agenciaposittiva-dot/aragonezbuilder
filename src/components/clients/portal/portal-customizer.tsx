"use client";

import { Copy, ExternalLink, Eye, History, PencilLine, RotateCcw, Save, Send, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { SaveIndicator } from "@/components/app/save-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Switch } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrgAction } from "@/hooks/use-action";
import { outcomeFromAction, useAutosave } from "@/hooks/use-autosave";
import { clearLocalDraft, loadLocalDraft, type LocalDraft } from "@/lib/autosave/local-draft";
import { formatDateTime } from "@/lib/format";
import { portalAssetUrl } from "@/lib/portal-assets";
import {
  assetFileId,
  BANNER_HEIGHT,
  contrastRatio,
  DEFAULT_LIGHT,
  DEFAULT_PORTAL_SETTINGS,
  PORTAL_ASSET_KEYS,
  PORTAL_SECTIONS,
  readableOn,
  type PortalSection,
  type PortalSettings,
  LOGIN_LAYOUT_LABEL,
  LOGIN_LAYOUTS,
} from "@/lib/portal-settings";
import { cn } from "@/lib/utils";
import {
  publishPortalAction,
  restorePortalDraftAction,
  savePortalDraftAction,
  updatePortalAccessAction,
} from "@/server/actions/client-portal";
import { ColorField, ContrastMeter, LinkListEditor, linkUrlError } from "./fields";
import { ImagePicker, imageVersionUrl, type PortalImageOption } from "./image-picker";
import { PortalPreview } from "./portal-preview";

type View = {
  client: { id: string; name: string; slug: string; logoFileId: string | null };
  draft: PortalSettings;
  published: PortalSettings | null;
  version: number;
  publishedAt: Date | null;
  loginEnabled: boolean;
  allowGuestInvites: boolean;
  versions: { version: number; createdAt: Date; publishedByName: string | null }[];
};

type Access = { slug: string; loginEnabled: boolean; allowGuestInvites: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const orNull = (v: string) => (v.trim() ? v : null);

/** Tela "Personalização do portal do cliente" (área interna da agência). */
export function PortalCustomizer({
  orgSlug,
  orgName,
  origin,
  view,
  images: initialImages,
  maxBytes,
  canWrite,
  canUpload,
}: {
  orgSlug: string;
  orgName: string;
  origin: string;
  view: View;
  images: PortalImageOption[];
  maxBytes: number;
  canWrite: boolean;
  canUpload: boolean;
}) {
  const clientId = view.client.id;
  const [settings, setSettings] = useState<PortalSettings>(view.draft);
  const [saved, setSaved] = useState<PortalSettings>(view.draft);
  const [savedStamp, setSavedStamp] = useState(0);
  const [published, setPublished] = useState<PortalSettings | null>(view.published);
  const [version, setVersion] = useState(view.version);
  const [publishedAt, setPublishedAt] = useState<Date | null>(view.publishedAt);
  const [images, setImages] = useState(initialImages);
  const [access, setAccess] = useState<Access>({
    slug: view.client.slug,
    loginEnabled: view.loginEnabled,
    allowGuestInvites: view.allowGuestInvites,
  });
  const [savedAccess, setSavedAccess] = useState<Access>(access);
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");

  const draftKey = `portal:${clientId}`;
  const [recovery, setRecovery] = useState<LocalDraft<PortalSettings> | null>(null);
  /** Último rascunho confirmado pelo servidor (lido ao publicar, depois do flush). */
  const confirmedRef = useRef<PortalSettings>(view.draft);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const autosave = useAutosave({
    enabled: canWrite,
    save: async () => {
      if (!valid) return { ok: false, kind: "rejected", message: "Revise os campos destacados para salvar." };
      const sent = settings;
      const res = await savePortalDraftAction(orgSlug, {
        clientId,
        settings: sent as unknown as Record<string, unknown>,
      }).catch(() => null);
      if (res && !res.ok) setErrors(res.fieldErrors ?? {});
      if (res?.ok) {
        setErrors({});
        confirmedRef.current = res.data;
        setSaved(res.data);
        // Edições feitas durante o envio continuam na tela (e serão salvas em seguida).
        setSettings((cur) => (cur === sent ? res.data : cur));
        setSavedStamp((n) => n + 1);
      }
      return outcomeFromAction(res);
    },
    draft: { key: draftKey, snapshot: () => settings, baseRevision: () => version },
  });

  // Alterações deste rascunho que ficaram só neste aparelho (aba fechada sem conexão).
  useEffect(() => {
    if (!canWrite) return;
    let alive = true;
    void loadLocalDraft<PortalSettings>(draftKey).then((d) => {
      if (!alive || !d) return;
      if (same(d.data, view.draft)) void clearLocalDraft(draftKey);
      else setRecovery(d);
    });
    return () => {
      alive = false;
    };
  }, [canWrite, draftKey, view.draft]);

  const publish = useOrgAction(publishPortalAction, {
    success: (d) => `Portal publicado (versão ${d.version})`,
  });
  const restore = useOrgAction(restorePortalDraftAction, {
    success: "Rascunho restaurado. Revise e publique quando estiver pronto.",
    onSuccess: (d) => {
      confirmedRef.current = d;
      setSaved(d);
      setSettings(d);
      setSavedStamp((n) => n + 1);
      autosave.markSaved();
    },
  });
  const saveAccess = useOrgAction(updatePortalAccessAction, {
    success: "Acesso ao portal atualizado",
    onSuccess: () => setSavedAccess(access),
  });

  const dirty = !same(settings, saved);
  const draftDiffers = !same(saved, published ?? DEFAULT_PORTAL_SETTINGS) || version === 0;
  const accessDirty = !same(access, savedAccess);

  const bg = settings.colors.background ?? DEFAULT_LIGHT.background;
  const fg = settings.colors.text ?? (settings.colors.background ? readableOn(bg) : DEFAULT_LIGHT.text);
  const contrastOk = contrastRatio(bg, fg) >= 4.5;
  const linkErrors = [
    ...settings.links.map((l) => linkUrlError(l.url) ?? (l.label.trim() ? null : "Informe o texto")),
    ...settings.actions.map((l) => linkUrlError(l.url) ?? (l.label.trim() ? null : "Informe o texto")),
    settings.banner.buttonUrl ? linkUrlError(settings.banner.buttonUrl) : null,
  ].filter(Boolean);
  const valid = contrastOk && linkErrors.length === 0;

  /** Toda alteração do rascunho passa por aqui: vai para o salvamento automático. */
  const edit = (fn: (s: PortalSettings) => PortalSettings) => {
    setSettings(fn);
    autosave.markDirty();
  };
  const patch = (p: Partial<PortalSettings>) => edit((s) => ({ ...s, ...p }));
  const patchColors = (p: Partial<PortalSettings["colors"]>) => edit((s) => ({ ...s, colors: { ...s.colors, ...p } }));
  const patchLogin = (p: Partial<PortalSettings["login"]>) => edit((s) => ({ ...s, login: { ...s.login, ...p } }));
  const patchBanner = (p: Partial<PortalSettings["banner"]>) => edit((s) => ({ ...s, banner: { ...s.banner, ...p } }));
  const patchContact = (p: Partial<PortalSettings["contact"]>) =>
    edit((s) => ({ ...s, contact: { ...s.contact, ...p } }));
  const patchSections = (p: Partial<PortalSettings["sections"]>) =>
    edit((s) => ({ ...s, sections: { ...s.sections, ...p } }));

  /** Imagem para a prévia: versão atual na biblioteca ou, se já salva no rascunho, a rota do portal. */
  const imageUrl = (fileId: string | null) => {
    if (!fileId) return null;
    const img = images.find((i) => i.id === fileId);
    if (img) return imageVersionUrl(img.versionId);
    const key = PORTAL_ASSET_KEYS.find((k) => assetFileId(saved, k) === fileId);
    return key ? portalAssetUrl(clientId, key, { draft: true, v: `${version}-${savedStamp}` }) : null;
  };
  const brandLogo = view.client.logoFileId ? images.find((i) => i.id === view.client.logoFileId) : null;
  const fallbackLogoUrl = brandLogo ? imageVersionUrl(brandLogo.versionId) : null;
  const displayName = settings.displayName ?? view.client.name;

  const pickerProps = {
    images,
    onUploaded: (img: PortalImageOption) => setImages((list) => [img, ...list.filter((i) => i.id !== img.id)]),
    orgSlug,
    clientId,
    maxBytes,
    disabled: !canWrite,
    canUpload: canWrite && canUpload,
  };

  /** Envia já o que estiver pendente; true só com a confirmação do servidor. */
  async function saveNow() {
    if (!valid) {
      toast.error("Revise os campos destacados antes de salvar.");
      return false;
    }
    const st = await autosave.flush();
    if (autosave.isPending() || st.status !== "saved") {
      toast.error(st.message ?? "O rascunho ainda não foi salvo no servidor. Tente de novo.");
      return false;
    }
    return true;
  }

  async function doPublish() {
    if (!(await saveNow())) return;
    const res = await publish.run({ clientId });
    if (res.ok) {
      setPublished(confirmedRef.current);
      setVersion(res.data.version);
      setPublishedAt(new Date());
    }
  }

  const loginUrl = `${origin}/portal/${orgSlug}/${savedAccess.slug}/entrar`;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div className="sticky top-14 z-10 -mx-1 flex flex-col gap-3 border-b border-border bg-bg/95 px-1 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Personalização do portal do cliente</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {version > 0 && publishedAt ? (
              <span>
                Publicado · versão {version} · {formatDateTime(publishedAt)}
              </span>
            ) : (
              <span>Ainda não publicado: o portal usa o padrão da agência.</span>
            )}
            {canWrite ? <SaveIndicator state={autosave.state} onRetry={() => void saveNow()} /> : null}
            {!dirty && draftDiffers && version > 0 ? <Badge tone="info">Rascunho diferente do publicado</Badge> : null}
            {!canWrite ? <Badge tone="outline">Somente leitura</Badge> : null}
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            {dirty && !valid ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSettings(saved);
                  autosave.markSaved();
                }}
              >
                <Undo2 /> Descartar
              </Button>
            ) : null}
            <Button
              size="sm"
              loading={autosave.state.status === "saving"}
              disabled={!dirty}
              onClick={() => void saveNow()}
            >
              <Save /> Salvar agora
            </Button>
            <ConfirmDialog
              tone="primary"
              title="Publicar a personalização?"
              description={`A identidade passa a valer agora no login e no portal de ${displayName}.${dirty ? " As alterações não salvas serão salvas antes." : ""}`}
              confirmLabel="Publicar"
              onConfirm={doPublish}
              trigger={
                <Button
                  variant="primary"
                  size="sm"
                  loading={publish.pending}
                  disabled={!valid || (!dirty && !draftDiffers)}
                >
                  <Send /> Publicar
                </Button>
              }
            />
          </div>
        ) : null}
      </div>

      {recovery ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Há alterações deste rascunho que não chegaram ao servidor (guardadas neste aparelho às{" "}
            {new Date(recovery.savedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}).
          </span>
          <span className="flex shrink-0 gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => {
                void clearLocalDraft(draftKey);
                setRecovery(null);
              }}
            >
              Descartar
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                const draft = recovery;
                setRecovery(null);
                edit(() => draft.data);
              }}
            >
              Recuperar alterações
            </Button>
          </span>
        </div>
      ) : null}

      <Tabs value={mobileTab} onValueChange={(v) => setMobileTab(v as "edit" | "preview")} className="xl:hidden">
        <TabsList aria-label="Modo">
          <TabsTrigger value="edit">
            <PencilLine /> Editar
          </TabsTrigger>
          <TabsTrigger value="preview">
            <Eye /> Prévia
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,540px)]">
        <fieldset
          disabled={!canWrite}
          className={cn("grid min-w-0 grid-cols-1 content-start gap-6", mobileTab === "preview" && "hidden xl:grid")}
        >
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Endereço e acesso</CardTitle>
                <CardDescription>O link que os convidados usam para entrar no portal deste cliente.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              <Field
                label="Endereço"
                htmlFor="pc-slug"
                error={saveAccess.fieldErrors.slug}
                hint="Letras minúsculas, números e hífens."
              >
                <div className="flex min-w-0 items-center rounded-md border border-border bg-surface-2 pl-3 text-sm text-fg-subtle shadow-xs focus-within:border-accent">
                  <span className="hidden shrink-0 truncate sm:inline">/portal/{orgSlug}/</span>
                  <input
                    id="pc-slug"
                    value={access.slug}
                    maxLength={48}
                    onChange={(e) =>
                      setAccess((a) => ({ ...a, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))
                    }
                    className="h-9 w-full min-w-0 bg-transparent pr-3 text-fg outline-none"
                  />
                </div>
              </Field>
              <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-2/60 p-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 truncate text-xs">{loginUrl}</code>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(loginUrl)
                        .then(() => toast.success("Link copiado"))
                        .catch(() => toast.error("Não foi possível copiar"))
                    }
                  >
                    <Copy /> Copiar
                  </Button>
                  <Button asChild size="sm">
                    <a href={loginUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Abrir
                    </a>
                  </Button>
                </div>
              </div>
              <ToggleRow
                id="pc-login"
                label="Página de login própria ativa"
                description="Desativada, o link leva ao login padrão da plataforma."
                checked={access.loginEnabled}
                onChange={(v) => setAccess((a) => ({ ...a, loginEnabled: v }))}
              />
              <ToggleRow
                id="pc-invites"
                label="Administradores do cliente podem convidar colegas"
                description="Só para pessoas do mesmo cliente e com papéis de convidado."
                checked={access.allowGuestInvites}
                onChange={(v) => setAccess((a) => ({ ...a, allowGuestInvites: v }))}
              />
              {canWrite ? (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    loading={saveAccess.pending}
                    disabled={!accessDirty || access.slug.length < 2}
                    onClick={() => void saveAccess.run({ clientId, ...access })}
                  >
                    Salvar acesso
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Identidade</CardTitle>
                <CardDescription>Nome, logotipos e cores aplicados só ao portal deste cliente.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Field
                label="Nome de exibição"
                htmlFor="pc-name"
                hint={`Padrão: ${view.client.name}`}
                error={errors.displayName}
              >
                <Input
                  id="pc-name"
                  value={settings.displayName ?? ""}
                  maxLength={80}
                  placeholder={view.client.name}
                  onChange={(e) => patch({ displayName: orNull(e.target.value) })}
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-3">
                <ImagePicker
                  {...pickerProps}
                  id="pc-logo"
                  label="Logotipo principal"
                  recommendation="PNG com fundo transparente, para fundos claros"
                  category="brand_logo"
                  aspect="aspect-[4/3]"
                  contain
                  value={settings.logoFileId}
                  onChange={(v) => patch({ logoFileId: v })}
                  error={errors.logoFileId}
                />
                <ImagePicker
                  {...pickerProps}
                  id="pc-logo-alt"
                  label="Logotipo alternativo"
                  recommendation="Versão para fundos escuros (banner e login)"
                  category="brand_logo"
                  aspect="aspect-[4/3]"
                  contain
                  value={settings.logoAltFileId}
                  onChange={(v) => patch({ logoAltFileId: v })}
                  error={errors.logoAltFileId}
                />
                <ImagePicker
                  {...pickerProps}
                  id="pc-favicon"
                  label="Ícone (favicon)"
                  recommendation="Quadrado, 512×512"
                  category="brand_logo"
                  aspect="aspect-[4/3]"
                  contain
                  value={settings.faviconFileId}
                  onChange={(v) => patch({ faviconFileId: v })}
                  error={errors.faviconFileId}
                />
              </div>
              {!settings.logoFileId ? (
                <p className="text-xs text-fg-subtle">
                  Sem logotipo principal, o portal usa o logotipo cadastrado na aba Marca
                  {brandLogo ? "" : " (nenhum cadastrado: aparecem as iniciais)"}.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ColorField
                  id="pc-primary"
                  label="Cor primária"
                  hint="Botões e destaques"
                  value={settings.colors.primary}
                  fallback="#f4bf2f"
                  onChange={(v) => patchColors({ primary: v })}
                  error={errors["colors.primary"]}
                />
                <ColorField
                  id="pc-secondary"
                  label="Cor secundária"
                  hint="Fundo do banner e do login sem imagem"
                  value={settings.colors.secondary}
                  fallback="#121110"
                  onChange={(v) => patchColors({ secondary: v })}
                  error={errors["colors.secondary"]}
                />
                <ColorField
                  id="pc-accent"
                  label="Cor de destaque"
                  hint="Detalhes e brilho do banner"
                  value={settings.colors.accent}
                  fallback={settings.colors.primary ?? "#f4bf2f"}
                  onChange={(v) => patchColors({ accent: v })}
                  error={errors["colors.accent"]}
                />
                <ColorField
                  id="pc-bg"
                  label="Cor de fundo"
                  value={settings.colors.background}
                  fallback={DEFAULT_LIGHT.background}
                  onChange={(v) => patchColors({ background: v })}
                  error={errors["colors.background"]}
                />
                <ColorField
                  id="pc-text"
                  label="Cor dos textos"
                  value={settings.colors.text}
                  fallback={fg}
                  onChange={(v) => patchColors({ text: v })}
                  error={errors["colors.text"]}
                />
              </div>
              <ContrastMeter text={fg} background={bg} />
              <Field label="Mensagem de boas-vindas" htmlFor="pc-welcome" error={errors.welcomeTitle}>
                <Input
                  id="pc-welcome"
                  value={settings.welcomeTitle ?? ""}
                  maxLength={120}
                  placeholder={`Bem-vindo ao portal de ${displayName}`}
                  onChange={(e) => patch({ welcomeTitle: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Texto de apresentação" htmlFor="pc-intro" error={errors.welcomeText}>
                <Textarea
                  id="pc-intro"
                  rows={3}
                  maxLength={600}
                  value={settings.welcomeText ?? ""}
                  placeholder={`Acompanhe projetos, aprove materiais e envie demandas para a ${orgName}.`}
                  onChange={(e) => patch({ welcomeText: orNull(e.target.value) })}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Tela de login</CardTitle>
                <CardDescription>Sem imagem, o fundo usa as cores da marca.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-[minmax(0,240px)_1fr]">
              <Field label="Layout" htmlFor="pc-login-layout" className="sm:col-span-2">
                <NativeSelect
                  id="pc-login-layout"
                  value={settings.login.layout}
                  onChange={(e) => patchLogin({ layout: e.target.value as PortalSettings["login"]["layout"] })}
                >
                  {LOGIN_LAYOUTS.map((l) => (
                    <option key={l} value={l}>
                      {LOGIN_LAYOUT_LABEL[l]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <ImagePicker
                {...pickerProps}
                id="pc-login-bg"
                label={settings.login.layout === "card" ? "Arte ao lado do login" : "Imagem de fundo"}
                recommendation={
                  settings.login.layout === "card"
                    ? "Paisagem, 1920×1080 (JPEG ou WebP). Logo do cliente no topo: 400×160."
                    : "Retrato, 1600×2000 (JPEG ou WebP)"
                }
                category="brand_asset"
                aspect={settings.login.layout === "card" ? "aspect-video" : "aspect-[4/5]"}
                value={settings.login.backgroundFileId}
                onChange={(v) => patchLogin({ backgroundFileId: v })}
                error={errors["login.backgroundFileId"]}
              />
              <div className="grid content-start gap-4">
                <Field
                  label="Título"
                  htmlFor="pc-login-title"
                  hint="Padrão: a mensagem de boas-vindas"
                  error={errors["login.title"]}
                >
                  <Input
                    id="pc-login-title"
                    value={settings.login.title ?? ""}
                    maxLength={120}
                    onChange={(e) => patchLogin({ title: orNull(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Mensagem"
                  htmlFor="pc-login-msg"
                  hint="Padrão: o texto de apresentação"
                  error={errors["login.message"]}
                >
                  <Textarea
                    id="pc-login-msg"
                    rows={3}
                    maxLength={400}
                    value={settings.login.message ?? ""}
                    onChange={(e) => patchLogin({ message: orNull(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Link da política de privacidade"
                  htmlFor="pc-login-privacy"
                  hint="Opcional. Aparece abaixo do botão Entrar."
                  error={errors["login.privacyUrl"]}
                >
                  <Input
                    id="pc-login-privacy"
                    type="url"
                    placeholder="https://"
                    maxLength={500}
                    value={settings.login.privacyUrl ?? ""}
                    onChange={(e) => patchLogin({ privacyUrl: orNull(e.target.value) })}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Banner de capa</CardTitle>
                <CardDescription>Aparece no topo do início do portal, como a capa de um site.</CardDescription>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Exibir
                <Switch
                  checked={settings.banner.enabled}
                  onCheckedChange={(v) => patchBanner({ enabled: v })}
                  aria-label="Exibir banner"
                />
              </label>
            </CardHeader>
            <CardContent className="grid gap-5">
              <ImagePicker
                {...pickerProps}
                id="pc-banner"
                label="Imagem do banner"
                recommendation="Panorâmica, 2400×800 (proporção 3:1). O ponto de foco mantém o assunto visível no celular"
                category="brand_asset"
                aspect="aspect-[3/1]"
                value={settings.banner.imageFileId}
                onChange={(v) => patchBanner({ imageFileId: v })}
                error={errors["banner.imageFileId"]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Título"
                  htmlFor="pc-b-title"
                  hint="Padrão: a mensagem de boas-vindas"
                  error={errors["banner.title"]}
                >
                  <Input
                    id="pc-b-title"
                    value={settings.banner.title ?? ""}
                    maxLength={120}
                    onChange={(e) => patchBanner({ title: orNull(e.target.value) })}
                  />
                </Field>
                <Field label="Subtítulo" htmlFor="pc-b-sub" error={errors["banner.subtitle"]}>
                  <Input
                    id="pc-b-sub"
                    value={settings.banner.subtitle ?? ""}
                    maxLength={300}
                    onChange={(e) => patchBanner({ subtitle: orNull(e.target.value) })}
                  />
                </Field>
                <Field label="Texto do botão" htmlFor="pc-b-btn" hint="Opcional" error={errors["banner.buttonLabel"]}>
                  <Input
                    id="pc-b-btn"
                    value={settings.banner.buttonLabel ?? ""}
                    maxLength={40}
                    placeholder="Ex.: Solicitar nova demanda"
                    onChange={(e) => patchBanner({ buttonLabel: orNull(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Link do botão"
                  htmlFor="pc-b-url"
                  hint="https://… ou caminho do portal, ex.: /requests/new"
                  error={
                    errors["banner.buttonUrl"] ??
                    (settings.banner.buttonUrl ? (linkUrlError(settings.banner.buttonUrl) ?? undefined) : undefined)
                  }
                >
                  <Input
                    id="pc-b-url"
                    value={settings.banner.buttonUrl ?? ""}
                    maxLength={500}
                    onChange={(e) => patchBanner({ buttonUrl: orNull(e.target.value) })}
                  />
                </Field>
                <Field label="Alinhamento" htmlFor="pc-b-align">
                  <NativeSelect
                    id="pc-b-align"
                    value={settings.banner.align}
                    onChange={(e) => patchBanner({ align: e.target.value as PortalSettings["banner"]["align"] })}
                  >
                    <option value="left">À esquerda</option>
                    <option value="center">Centralizado</option>
                    <option value="right">À direita</option>
                  </NativeSelect>
                </Field>
                <Field label="Posição vertical" htmlFor="pc-b-valign">
                  <NativeSelect
                    id="pc-b-valign"
                    value={settings.banner.verticalAlign}
                    onChange={(e) =>
                      patchBanner({ verticalAlign: e.target.value as PortalSettings["banner"]["verticalAlign"] })
                    }
                  >
                    <option value="top">Topo</option>
                    <option value="center">Centro</option>
                    <option value="bottom">Base</option>
                  </NativeSelect>
                </Field>
                <Field label="Sobreposição" htmlFor="pc-b-overlay" hint="Melhora a leitura do texto sobre a imagem">
                  <NativeSelect
                    id="pc-b-overlay"
                    value={settings.banner.overlay}
                    onChange={(e) => patchBanner({ overlay: e.target.value as PortalSettings["banner"]["overlay"] })}
                  >
                    <option value="gradient">Gradiente</option>
                    <option value="dark">Escura</option>
                    <option value="light">Clara</option>
                    <option value="none">Nenhuma</option>
                  </NativeSelect>
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <Checkbox
                    checked={settings.banner.showLogo}
                    onCheckedChange={(v) => patchBanner({ showLogo: v === true })}
                  />
                  Mostrar logotipo no banner
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <RangeField
                  id="pc-b-height"
                  label="Altura"
                  value={settings.banner.height}
                  min={BANNER_HEIGHT.min}
                  max={BANNER_HEIGHT.max}
                  step={10}
                  unit="px"
                  onChange={(v) => patchBanner({ height: v })}
                />
                <RangeField
                  id="pc-b-opacity"
                  label="Intensidade da sobreposição"
                  value={settings.banner.overlayOpacity}
                  min={0}
                  max={90}
                  step={5}
                  unit="%"
                  disabled={settings.banner.overlay === "none"}
                  onChange={(v) => patchBanner({ overlayOpacity: v })}
                />
                <RangeField
                  id="pc-b-fx"
                  label="Foco horizontal"
                  value={settings.banner.focalX}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(v) => patchBanner({ focalX: v })}
                />
                <RangeField
                  id="pc-b-fy"
                  label="Foco vertical"
                  value={settings.banner.focalY}
                  min={0}
                  max={100}
                  step={1}
                  unit="%"
                  onChange={(v) => patchBanner({ focalY: v })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Links e botões</CardTitle>
                <CardDescription>Caminhos do portal começam com “/”, ex.: /requests/new ou /approvals.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="grid gap-2">
                <p className="text-sm font-medium">Botões de ação em destaque (até 3)</p>
                <LinkListEditor
                  idPrefix="actions"
                  items={settings.actions}
                  max={3}
                  withStyle
                  errors={errors}
                  addLabel="Adicionar botão"
                  onChange={(items) =>
                    patch({
                      actions: items.map((i) => ({ label: i.label, url: i.url, style: i.style ?? "primary" })),
                    })
                  }
                />
              </div>
              <div className="grid gap-2">
                <p className="text-sm font-medium">Links úteis (até 8)</p>
                <LinkListEditor
                  idPrefix="links"
                  items={settings.links}
                  max={8}
                  errors={errors}
                  addLabel="Adicionar link"
                  onChange={(items) => patch({ links: items.map((i) => ({ label: i.label, url: i.url })) })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Contato</CardTitle>
                <CardDescription>Quem o cliente procura na agência.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="pc-c-name" error={errors["contact.name"]}>
                <Input
                  id="pc-c-name"
                  value={settings.contact.name ?? ""}
                  maxLength={80}
                  onChange={(e) => patchContact({ name: orNull(e.target.value) })}
                />
              </Field>
              <Field label="E-mail" htmlFor="pc-c-email" error={errors["contact.email"]}>
                <Input
                  id="pc-c-email"
                  type="email"
                  value={settings.contact.email ?? ""}
                  onChange={(e) => patchContact({ email: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Telefone" htmlFor="pc-c-phone" error={errors["contact.phone"]}>
                <Input
                  id="pc-c-phone"
                  value={settings.contact.phone ?? ""}
                  maxLength={40}
                  onChange={(e) => patchContact({ phone: orNull(e.target.value) })}
                />
              </Field>
              <Field label="WhatsApp" htmlFor="pc-c-wa" error={errors["contact.whatsapp"]}>
                <Input
                  id="pc-c-wa"
                  value={settings.contact.whatsapp ?? ""}
                  maxLength={40}
                  onChange={(e) => patchContact({ whatsapp: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Horário de atendimento" htmlFor="pc-c-hours" error={errors["contact.hours"]}>
                <Input
                  id="pc-c-hours"
                  value={settings.contact.hours ?? ""}
                  maxLength={120}
                  placeholder="Seg. a sex., 9h às 18h"
                  onChange={(e) => patchContact({ hours: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Observação" htmlFor="pc-c-note" error={errors["contact.note"]}>
                <Input
                  id="pc-c-note"
                  value={settings.contact.note ?? ""}
                  maxLength={300}
                  onChange={(e) => patchContact({ note: orNull(e.target.value) })}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Seções exibidas</CardTitle>
                <CardDescription>
                  O que aparece no início do portal. Os dados são sempre os deste cliente.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(PORTAL_SECTIONS) as PortalSection[]).map((key) => (
                  <li key={key}>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={settings.sections[key]}
                        onCheckedChange={(v) => patchSections({ [key]: v === true })}
                      />
                      {PORTAL_SECTIONS[key]}
                    </label>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <History className="size-4 text-fg-subtle" /> Versões publicadas
                </CardTitle>
                <CardDescription>
                  Restaurar leva a versão para o rascunho; nada muda no portal até publicar.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {view.versions.length ? (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {view.versions.map((v) => (
                    <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                      <span className="text-sm">
                        <span className="font-medium">Versão {v.version}</span>
                        <span className="text-fg-muted">
                          {" "}
                          · {formatDateTime(v.createdAt)}
                          {v.publishedByName ? ` · ${v.publishedByName}` : ""}
                        </span>
                      </span>
                      {canWrite ? (
                        <ConfirmDialog
                          tone="primary"
                          title={`Restaurar a versão ${v.version} no rascunho?`}
                          description="O rascunho atual será substituído. O portal publicado não muda até você publicar."
                          confirmLabel="Restaurar"
                          onConfirm={() => restore.run({ clientId, version: v.version })}
                          trigger={
                            <Button size="xs" variant="ghost">
                              <RotateCcw /> Restaurar no rascunho
                            </Button>
                          }
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">Nenhuma versão publicada ainda.</p>
              )}
              {canWrite ? (
                <div>
                  <ConfirmDialog
                    title="Restaurar o padrão da agência?"
                    description="O rascunho volta à apresentação padrão (sem imagens, cores ou textos próprios). O portal publicado não muda até você publicar."
                    confirmLabel="Restaurar padrão"
                    onConfirm={() => restore.run({ clientId })}
                    trigger={
                      <Button size="sm" variant="danger-ghost">
                        <RotateCcw /> Restaurar padrão da agência
                      </Button>
                    }
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>
        </fieldset>

        <aside
          className={cn("min-w-0 xl:sticky xl:top-32 xl:self-start", mobileTab === "edit" && "hidden xl:block")}
          aria-label="Prévia"
        >
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Prévia</CardTitle>
                <CardDescription>Mostra o rascunho em edição, inclusive o que ainda não foi salvo.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <PortalPreview
                settings={settings}
                name={displayName}
                orgName={orgName}
                imageUrl={imageUrl}
                fallbackLogoUrl={fallbackLogoUrl}
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-fg-muted">{description}</span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function RangeField({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <span className="tabular text-xs text-fg-muted">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent-text)] disabled:opacity-50"
      />
    </div>
  );
}

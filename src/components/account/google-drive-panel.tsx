"use client";

import { Cloud, FolderPlus, FolderOpen, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { formatBytes, formatDateTime } from "@/lib/format";
import {
  createDriveFolderAction,
  disconnectGoogleDriveAction,
  ensureDriveRootFolderAction,
  listDriveFolderAction,
  testGoogleDriveAction,
  updateGoogleDriveSettingsAction,
} from "@/server/actions/google-drive";
import type { DriveEntry, DriveStatus, OrganizeBy } from "@/server/services/google-drive";

/*
 * Painel do Google Drive pessoal: estado da conexão, conta, teste, pasta
 * padrão, organização e destino preferido. Nada aqui recebe tokens.
 */

const ORGANIZE: { value: OrganizeBy; label: string }[] = [
  { value: "none", label: "Tudo na pasta padrão" },
  { value: "client", label: "Pasta por cliente" },
  { value: "client_project", label: "Pasta por cliente e projeto" },
  { value: "client_project_year", label: "Pasta por cliente, projeto e ano" },
];

const STATUS: Record<NonNullable<DriveStatus["status"]>, { label: string; tone: "success" | "warning" | "danger" }> = {
  connected: { label: "Conectado", tone: "success" },
  reauth_required: { label: "Autorização necessária", tone: "warning" },
  error: { label: "Erro", tone: "danger" },
};

export function GoogleDrivePanel({
  status,
  orgSlug,
  notice,
}: {
  status: DriveStatus;
  orgSlug: string;
  notice: { tone: "success" | "danger"; text: string } | null;
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const test = useOrgAction(testGoogleDriveAction, { onSuccess: refresh });
  const disconnect = useOrgAction(disconnectGoogleDriveAction, {
    success: "Conta Google desconectada",
    onSuccess: refresh,
  });
  const save = useOrgAction(updateGoogleDriveSettingsAction, { success: "Preferências salvas", onSuccess: refresh });
  const [testResult, setTestResult] = useState<string | null>(null);
  const connectHref = `/api/integrations/google-drive/connect?org=${encodeURIComponent(orgSlug)}`;
  const st = status.status ? STATUS[status.status] : null;

  return (
    <div className="grid max-w-3xl gap-6 [&>*]:min-w-0">
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === "success"
              ? "rounded-md bg-success-soft px-3 py-2 text-sm text-success"
              : "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger"
          }
          data-testid="drive-notice"
        >
          {notice.text}
        </p>
      ) : null}

      <Card data-testid="drive-connection">
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="size-4 text-accent-text" aria-hidden="true" /> Google Drive
            </CardTitle>
            <CardDescription>
              Autorização oficial do Google (OAuth 2.0). Escopo{" "}
              {status.broadScope ? "amplo (todo o Drive)" : "restrito: só arquivos e pastas criados pela plataforma"}.
              Nada é compartilhado nem tornado público.
            </CardDescription>
          </div>
          {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge tone="outline">Não conectado</Badge>}
        </CardHeader>
        <CardContent className="grid gap-3">
          {!status.configured ? (
            <p className="text-sm text-fg-muted" data-testid="drive-unconfigured">
              O Google Drive não está configurado neste servidor. Quem administra o servidor precisa criar as
              credenciais OAuth no Google Cloud Console e definir GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (passo a passo
              em docs/GOOGLE-DRIVE.md).
            </p>
          ) : null}
          {status.connected ? (
            <>
              <p className="text-sm">
                Conta: <span className="font-medium">{status.email ?? "(e-mail não informado)"}</span>
                {status.lastCheckedAt ? (
                  <span className="text-fg-muted"> · verificada em {formatDateTime(status.lastCheckedAt)}</span>
                ) : null}
              </p>
              {status.lastError && status.status !== "connected" ? (
                <p className="text-sm text-danger">{status.lastError}</p>
              ) : null}
              {testResult ? <p className="text-sm text-fg-muted">{testResult}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={test.pending}
                  onClick={async () => {
                    setTestResult(null);
                    const res = await test.run({});
                    if (!res.ok) return;
                    setTestResult(
                      res.data.ok
                        ? `Acesso confirmado para ${res.data.email ?? "a conta"}${
                            res.data.quota?.limit
                              ? ` · ${formatBytes(res.data.quota.usage)} de ${formatBytes(res.data.quota.limit)} usados`
                              : ""
                          }.`
                        : res.data.error,
                    );
                  }}
                  data-testid="drive-test"
                >
                  <RefreshCw /> Testar acesso
                </Button>
                {status.status !== "connected" ? (
                  <Button variant="primary" size="sm" asChild>
                    <a href={connectHref}>Renovar autorização</a>
                  </Button>
                ) : null}
                <ConfirmDialog
                  title="Desconectar o Google Drive?"
                  description="A autorização é revogada no Google e os tokens são apagados do servidor. Os arquivos já enviados continuam no seu Drive e as cópias na plataforma continuam aqui."
                  confirmLabel="Desconectar"
                  onConfirm={() => disconnect.run({})}
                  trigger={
                    <Button variant="danger-ghost" size="sm" loading={disconnect.pending}>
                      <Unplug /> Desconectar
                    </Button>
                  }
                />
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                asChild={status.configured}
                disabled={!status.configured}
                data-testid="drive-connect"
              >
                {status.configured ? (
                  <a href={connectHref}>Conectar conta Google</a>
                ) : (
                  <span>Conectar conta Google</span>
                )}
              </Button>
              <span className="text-xs text-fg-muted">
                Você será levado ao Google para autorizar; volte aqui depois.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {status.connected ? (
        <>
          <Card data-testid="drive-settings">
            <CardHeader>
              <div>
                <CardTitle>Destino e organização</CardTitle>
                <CardDescription>
                  Onde os arquivos elegíveis vão parar. A plataforma sempre guarda os metadados e a cópia própria; o
                  Drive recebe o original exportado.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save.run({
                    preferredDestination: String(f.get("preferredDestination")) as "platform" | "drive",
                    organizeBy: String(f.get("organizeBy")) as OrganizeBy,
                  });
                }}
              >
                <Field label="Destino preferido dos novos arquivos" htmlFor="drive-dest">
                  <NativeSelect id="drive-dest" name="preferredDestination" defaultValue={status.preferredDestination}>
                    <option value="platform">Armazenamento da plataforma</option>
                    <option value="drive">Plataforma + cópia no meu Google Drive</option>
                  </NativeSelect>
                </Field>
                <Field label="Organização das pastas" htmlFor="drive-org">
                  <NativeSelect id="drive-org" name="organizeBy" defaultValue={status.organizeBy}>
                    {ORGANIZE.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="primary" loading={save.pending}>
                    Salvar preferências
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <FolderCard status={status} />
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pasta padrão (entre as pastas que a plataforma pode ver)            */
/* ------------------------------------------------------------------ */

function FolderCard({ status }: { status: DriveStatus }) {
  const router = useRouter();
  const list = useOrgAction(listDriveFolderAction);
  const create = useOrgAction(createDriveFolderAction);
  const ensureRoot = useOrgAction(ensureDriveRootFolderAction);
  const save = useOrgAction(updateGoogleDriveSettingsAction, {
    success: "Pasta padrão salva",
    onSuccess: () => router.refresh(),
  });
  const [folders, setFolders] = useState<DriveEntry[] | null>(null);
  const [current, setCurrent] = useState<{ id: string; name: string; parentId: string | null } | null>(null);
  const [newName, setNewName] = useState("");

  async function open(folderId: string | null) {
    const res = await list.run({ folderId, foldersOnly: true });
    if (!res.ok) return;
    setFolders(res.data.entries.filter((e) => e.isFolder));
    setCurrent(res.data.folder);
  }

  return (
    <Card data-testid="drive-folder">
      <CardHeader>
        <div>
          <CardTitle>Pasta padrão</CardTitle>
          <CardDescription>
            {status.defaultFolderName
              ? `Atual: ${status.defaultFolderName}.`
              : 'Atual: pasta raiz "Aragonez Builder" (criada pela plataforma no seu Drive).'}{" "}
            Só aparecem pastas que a plataforma criou ou que você abriu por ela.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={list.pending} onClick={() => void open(null)}>
            <FolderOpen /> Escolher pasta
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={ensureRoot.pending}
            onClick={async () => {
              const res = await ensureRoot.run({});
              if (res.ok) toast.success(`Pasta "${res.data.name}" pronta no seu Drive.`);
            }}
          >
            <FolderPlus /> Criar pasta &ldquo;Aragonez Builder&rdquo;
          </Button>
          {status.defaultFolderId ? (
            <Button
              variant="ghost"
              size="sm"
              loading={save.pending}
              onClick={() => void save.run({ defaultFolderId: null })}
            >
              Voltar à pasta raiz
            </Button>
          ) : null}
        </div>
        {folders ? (
          <div className="grid gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{current?.name ?? "Raiz"}</span>
              {current?.parentId ? (
                <Button variant="ghost" size="xs" onClick={() => void open(current.parentId)}>
                  Voltar
                </Button>
              ) : null}
              <span className="flex-1" />
              {current ? (
                <Button
                  variant="primary"
                  size="xs"
                  loading={save.pending}
                  onClick={() => void save.run({ defaultFolderId: current.id })}
                >
                  Usar esta pasta
                </Button>
              ) : null}
            </div>
            {folders.length ? (
              <ul className="grid gap-1">
                {folders.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-surface-2"
                      onClick={() => void open(f.id)}
                    >
                      <FolderOpen className="size-4 text-fg-subtle" /> {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-muted">Nenhuma subpasta.</p>
            )}
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                const res = await create.run({ name: newName.trim(), parentId: current?.id ?? null });
                if (!res.ok) return;
                setNewName("");
                toast.success(`Pasta "${res.data.name}" criada.`);
                void open(current?.id ?? null);
              }}
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nova subpasta"
                aria-label="Nome da nova pasta"
              />
              <Button type="submit" variant="secondary" loading={create.pending} disabled={!newName.trim()}>
                <FolderPlus /> Criar
              </Button>
            </form>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

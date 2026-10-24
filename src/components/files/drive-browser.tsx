"use client";

import {
  ArrowLeft,
  Cloud,
  Download,
  ExternalLink,
  FileIcon as FileGlyph,
  FolderOpen,
  FolderPlus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { formatBytes, formatDateTime } from "@/lib/format";
import { createDriveFolderAction, importFromDriveAction, listDriveFolderAction } from "@/server/actions/google-drive";
import type { DriveEntry, DriveStatus } from "@/server/services/google-drive";

/*
 * Navegador do Google Drive da pessoa dentro da biblioteca: pastas autorizadas,
 * busca por nome, importar para um cliente/projeto, criar pasta, abrir no
 * Drive. Só mostra o que a conexão da própria pessoa alcança.
 */

type Folder = { id: string; name: string; parentId: string | null };

export function DriveBrowser({
  status,
  orgSlug,
  clients,
  projects,
}: {
  status: DriveStatus;
  orgSlug: string;
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string }[];
}) {
  const router = useRouter();
  const list = useOrgAction(listDriveFolderAction);
  const importFile = useOrgAction(importFromDriveAction);
  const create = useOrgAction(createDriveFolderAction);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [entries, setEntries] = useState<DriveEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const integrations = `/w/${orgSlug}/account/integrations`;

  async function load(o: { folderId?: string | null; query?: string | null; pageToken?: string | null } = {}) {
    setError(null);
    const res = await list.run({
      folderId: o.folderId ?? null,
      query: o.query ?? null,
      pageToken: o.pageToken ?? null,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setFolder(res.data.folder);
    setEntries((prev) => (o.pageToken && prev ? [...prev, ...res.data.entries] : res.data.entries));
    setNext(res.data.nextPageToken);
    setSearching(!!o.query);
  }

  useEffect(() => {
    if (!status.connected) return;
    // Carrega a raiz uma vez ao abrir (fora do corpo do efeito, para não atualizar estado durante a renderização).
    const t = setTimeout(() => void load({}), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.connected]);

  if (!status.configured) {
    return (
      <div data-testid="drive-browser-empty">
        <EmptyState
          icon={Cloud}
          title="Google Drive não está configurado neste servidor"
          description="Quem administra o servidor precisa criar as credenciais OAuth no Google Cloud Console (docs/GOOGLE-DRIVE.md). Depois, cada pessoa conecta a própria conta."
        />
      </div>
    );
  }
  if (!status.connected) {
    return (
      <div data-testid="drive-browser-empty">
        <EmptyState
          icon={Cloud}
          title="Conecte a sua conta Google"
          description="A conexão é só sua: outra pessoa não usa o seu Drive. Depois de conectar, suas pastas aparecem aqui para importar e enviar arquivos."
          action={
            <Button variant="primary" asChild>
              <Link href={integrations}>Conectar em Armazenamento e integrações</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const projectsOf = clientId ? projects.filter((p) => p.clientId === clientId) : projects;

  return (
    <div className="grid gap-4">
      {status.status !== "connected" ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          {status.lastError ?? "A autorização precisa ser renovada."}{" "}
          <Link href={integrations} className="underline">
            Renovar em Armazenamento e integrações
          </Link>
          .
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(query.trim() ? { query: query.trim() } : {});
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome no Drive"
            aria-label="Buscar no Google Drive"
            className="w-64"
          />
          <Button type="submit" variant="secondary" loading={list.pending}>
            <Search /> Buscar
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-fg-muted">Importar para:</span>
          <NativeSelect
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId("");
            }}
            aria-label="Cliente de destino"
            className="h-8 text-xs"
          >
            <option value="">Sem cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Projeto de destino"
            className="h-8 text-xs"
          >
            <option value="">Sem projeto</option>
            {projectsOf.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {searching ? (
              <>
                <span className="font-medium">Resultados da busca</span>
                <Button variant="ghost" size="xs" onClick={() => void load({})}>
                  <ArrowLeft /> Voltar às pastas
                </Button>
              </>
            ) : (
              <>
                <FolderOpen className="size-4 text-fg-subtle" />
                <span className="font-medium">{folder?.name ?? "Pasta raiz"}</span>
                {folder?.parentId && folder.id !== status.rootFolderId ? (
                  <Button variant="ghost" size="xs" onClick={() => void load({ folderId: folder.parentId })}>
                    <ArrowLeft /> Voltar
                  </Button>
                ) : null}
              </>
            )}
            <span className="flex-1" />
            {!searching ? (
              <form
                className="flex gap-1"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newFolder.trim()) return;
                  const res = await create.run({ name: newFolder.trim(), parentId: folder?.id ?? null });
                  if (!res.ok) return;
                  setNewFolder("");
                  toast.success(`Pasta "${res.data.name}" criada.`);
                  void load({ folderId: folder?.id ?? null });
                }}
              >
                <Input
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  placeholder="Nova pasta"
                  aria-label="Nome da nova pasta"
                  className="h-8 w-40 text-xs"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  loading={create.pending}
                  disabled={!newFolder.trim()}
                >
                  <FolderPlus /> Criar
                </Button>
              </form>
            ) : null}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {entries === null ? (
            <p className="text-sm text-fg-muted">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="drive-browser-list-empty">
              {searching ? "Nada encontrado com esse nome." : "Pasta vazia."}
            </p>
          ) : (
            <ul className="divide-y divide-border" data-testid="drive-browser-list">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2">
                  {e.isFolder ? (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:underline"
                      onClick={() => void load({ folderId: e.id })}
                    >
                      <FolderOpen className="size-4 shrink-0 text-fg-subtle" />
                      <span className="truncate font-medium">{e.name}</span>
                    </button>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <FileGlyph className="size-4 shrink-0 text-fg-subtle" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.name}</span>
                        <span className="block truncate text-xs text-fg-muted">
                          {e.mimeType}
                          {e.sizeBytes !== null ? ` · ${formatBytes(e.sizeBytes)}` : ""}
                          {e.modifiedAt ? ` · ${formatDateTime(e.modifiedAt)}` : ""}
                        </span>
                      </span>
                    </span>
                  )}
                  <Badge tone="outline">Google Drive</Badge>
                  {e.webViewLink ? (
                    <Button variant="ghost" size="xs" asChild>
                      <a href={e.webViewLink} target="_blank" rel="noreferrer">
                        <ExternalLink /> Abrir no Drive
                      </a>
                    </Button>
                  ) : null}
                  {!e.isFolder && !e.mimeType.startsWith("application/vnd.google-apps.") ? (
                    <Button
                      variant="secondary"
                      size="xs"
                      loading={busyId === e.id}
                      disabled={!!busyId}
                      onClick={async () => {
                        setBusyId(e.id);
                        try {
                          const res = await importFile.run({
                            driveFileId: e.id,
                            clientId: clientId || null,
                            projectId: projectId || null,
                          });
                          if (!res.ok) return;
                          toast.success(`${res.data.name} importado para a biblioteca.`);
                          router.refresh();
                        } finally {
                          setBusyId(null);
                        }
                      }}
                    >
                      <Download /> Importar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {next ? (
            <Button
              variant="ghost"
              size="sm"
              loading={list.pending}
              onClick={() =>
                void load({ folderId: folder?.id ?? null, query: searching ? query : null, pageToken: next })
              }
            >
              Carregar mais
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

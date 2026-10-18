import { fileListParams, FILE_CATEGORIES, FILE_STATUSES } from "@/lib/validators/files";
import { can, type Scope } from "@/server/authz";
import { clientOptions } from "./clients";
import { listFiles, listFolders, maxUploadBytes } from "./files";
import { projectOptions } from "./projects";

type SP = Record<string, string | string[] | undefined>;

/** Converte a URL em filtros válidos (valores inválidos são ignorados). */
export function parseFileFilters(sp: SP, fixed: { clientId?: string; projectId?: string } = {}) {
  const pick = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const category = pick("category");
  const status = pick("status");
  const parsed = fileListParams.safeParse({
    q: pick("q"),
    clientId: fixed.clientId ?? pick("clientId"),
    projectId: fixed.projectId ?? pick("projectId"),
    folderId: pick("folderId"),
    category: FILE_CATEGORIES.includes(category as never) ? category : undefined,
    status: FILE_STATUSES.includes(status as never) ? status : undefined,
    tag: pick("tag"),
    favorites: pick("favorites") === "1" || undefined,
    final: pick("final") === "1" || undefined,
    page: pick("page") ?? 1,
  });
  return parsed.success ? parsed.data : fileListParams.parse({ ...fixed });
}

/** Dados da biblioteca de arquivos (central, cliente ou projeto). */
export async function loadFilesLibrary(s: Scope, sp: SP, fixed: { clientId?: string; projectId?: string } = {}) {
  const filters = parseFileFilters(sp, fixed);
  const list = await listFiles(s, filters);
  const folders = await listFolders(
    s,
    fixed.projectId ? { projectId: fixed.projectId } : fixed.clientId ? { clientId: fixed.clientId } : {},
  );
  const clients = fixed.clientId ? [] : await clientOptions(s);
  const projects = fixed.projectId ? [] : await projectOptions(s, fixed.clientId);
  return {
    list,
    folders,
    clients,
    projects: projects.map((p) => ({ id: p.id, name: p.name, clientId: p.clientId })),
    canWrite: can(s.actor, "files.write"),
    maxBytes: maxUploadBytes(s),
  };
}

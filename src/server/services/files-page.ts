import {
  CLOUD_SECTIONS,
  fileListParams,
  FILE_CATEGORIES,
  FILE_KINDS,
  FILE_SORTS,
  FILE_STATUSES,
  FILE_TYPES,
} from "@/lib/validators/files";
import { can, type Scope } from "@/server/authz";
import { clientOptions } from "./clients";
import { listDesigns } from "./designs";
import { listFiles, listFolders, maxUploadBytes, storageUsage } from "./files";
import { projectOptions } from "./projects";

const oneOf = <T extends string>(value: string | undefined, options: Record<T, unknown>) =>
  value && value in options ? (value as T) : undefined;
const isoDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

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
    kind: oneOf(pick("kind"), FILE_KINDS),
    type: oneOf(pick("type"), FILE_TYPES),
    section: oneOf(pick("section"), CLOUD_SECTIONS),
    from: isoDay(pick("from")),
    to: isoDay(pick("to")),
    sort: oneOf(pick("sort"), FILE_SORTS),
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
    canDelete: can(s.actor, "files.delete"),
    maxBytes: maxUploadBytes(s),
  };
}

/** Minha Nuvem: biblioteca + uso do armazenamento + artes editadas recentemente. */
export async function loadCloud(s: Scope, sp: SP) {
  const library = await loadFilesLibrary(s, sp);
  const usage = await storageUsage(s);
  const recentDesigns = can(s.actor, "designs.read")
    ? (await listDesigns(s)).slice(0, 6).map((d) => ({
        id: d.id,
        name: d.name,
        thumbnail: d.thumbnail,
        clientName: d.clientName,
        updatedAt: d.updatedAt,
      }))
    : [];
  return { ...library, usage, recentDesigns };
}

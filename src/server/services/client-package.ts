import { posix } from "node:path";
import { unzipSync } from "fflate";
import { formatBytes } from "@/lib/format";
import { type PortalAssetKey } from "@/lib/portal-settings";
import { clientPackageSchema, PACKAGE_LIMITS, type ClientPackage } from "@/lib/validators/client-package";
import { assertCan, assertInternal, type Scope } from "@/server/authz";
import { ValidationError } from "@/server/errors";
import { publishPortal, savePortalDraft, updatePortalAccess } from "./client-portal";
import { createClient, getClient, updateBrandProfile } from "./clients";
import { maxUploadBytes, setClientLogo, storeUpload } from "./files";
import { createProject } from "./projects";
import { createTask } from "./tasks";

/*
 * Importação de pacote de cliente (.zip com manifest.json). Reaproveita os
 * serviços de sempre, então cada etapa aplica as mesmas permissões e
 * validações dos formulários; tudo roda na transação do chamador (inOrg):
 * se uma etapa falhar, nada fica gravado no banco.
 */

type Entries = Map<string, Uint8Array>;

const MANIFEST = "manifest.json";

function isJunk(name: string) {
  const base = posix.basename(name);
  return name.startsWith("__MACOSX/") || base === ".DS_Store" || base === "Thumbs.db" || base.startsWith("._");
}

function normalize(name: string) {
  return name.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
}

/** Lê o zip com limites de quantidade e tamanho; ignora pastas e lixo de sistema. */
export function readPackageZip(buffer: Buffer): { root: string; entries: Entries } {
  let total = 0;
  let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (f.name.endsWith("/") || isJunk(normalize(f.name))) return false;
        if (f.originalSize > PACKAGE_LIMITS.entryBytes) {
          throw new ValidationError(
            `O item ${f.name} passa de ${formatBytes(PACKAGE_LIMITS.entryBytes)} dentro do pacote.`,
          );
        }
        total += f.originalSize;
        count += 1;
        if (total > PACKAGE_LIMITS.totalBytes || count > PACKAGE_LIMITS.entries) {
          throw new ValidationError("O pacote é grande demais para ser importado de uma vez.");
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("Não foi possível ler o arquivo. Envie um .zip válido.");
  }
  const entries: Entries = new Map(Object.entries(raw).map(([name, data]) => [normalize(name), data]));
  let root = "";
  if (!entries.has(MANIFEST)) {
    // Pacote zipado como pasta: aceita uma única pasta de primeiro nível com o manifesto.
    const candidates = [...entries.keys()].filter((k) => /^[^/]+\/manifest\.json$/.test(k));
    if (candidates.length !== 1) {
      throw new ValidationError(`O pacote precisa de um ${MANIFEST} na raiz (ou dentro de uma única pasta).`);
    }
    root = candidates[0]!.slice(0, -MANIFEST.length);
  }
  return { root, entries };
}

/** Valida o manifesto e confere que todo arquivo listado existe no zip. */
export function parseManifest(entries: Entries, root: string): ClientPackage {
  const data = entries.get(root + MANIFEST)!;
  if (data.length > PACKAGE_LIMITS.manifestBytes) throw new ValidationError(`${MANIFEST} grande demais.`);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new ValidationError(`${MANIFEST} não é um JSON válido (UTF-8).`);
  }
  const parsed = clientPackageSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` em "${first.path.join(".")}"` : "";
    throw new ValidationError(
      `${MANIFEST} inválido${where}: ${first?.message ?? "revise o formato"}.`,
      Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])),
    );
  }
  for (const f of parsed.data.files) {
    if (!entries.has(root + f.path)) {
      throw new ValidationError(`O arquivo ${f.path} está no manifesto, mas não dentro do pacote.`);
    }
  }
  return parsed.data;
}

export type ImportResult = {
  clientId: string;
  name: string;
  files: number;
  projects: number;
  tasks: number;
  portal: "published" | "draft" | "none";
};

/**
 * Importa o pacote: cliente → marca → arquivos (e logotipo) → projetos e
 * demandas → portal (rascunho, publicação e acesso). As permissões são as dos
 * serviços de cada etapa; as de arquivos, projetos e demandas são conferidas
 * antes de gravar qualquer coisa, para falhar cedo.
 */
export async function importClientPackage(
  s: Scope,
  zip: Buffer,
  opts: { categoryId?: string | null } = {},
): Promise<ImportResult> {
  assertInternal(s.actor);
  assertCan(s.actor, "clients.write");
  const max = maxUploadBytes(s);
  if (zip.length > max) {
    throw new ValidationError(`O pacote tem ${formatBytes(zip.length)}; o limite é ${formatBytes(max)}.`);
  }
  const { root, entries } = readPackageZip(zip);
  const pkg = parseManifest(entries, root);
  if (pkg.files.length) assertCan(s.actor, "files.write");
  if (pkg.projects.length) assertCan(s.actor, "projects.write");
  if (pkg.projects.some((p) => p.tasks.length)) assertCan(s.actor, "tasks.write");

  const { id: clientId } = await createClient(s, { ...pkg.client, categoryId: opts.categoryId ?? undefined });
  if (pkg.brand) await updateBrandProfile(s, { clientId, ...pkg.brand });

  const fileIds = new Map<string, string>();
  let logoFileId: string | null = null;
  for (const f of pkg.files) {
    const data = entries.get(root + f.path)!;
    const res = await storeUpload(
      s,
      { buffer: Buffer.from(data), originalName: posix.basename(f.path) },
      { clientId, category: f.category, tags: f.tags, note: f.note },
    );
    fileIds.set(f.path, res.fileId);
    if (f.logo) logoFileId = res.fileId;
  }
  if (logoFileId) await setClientLogo(s, clientId, logoFileId);

  let tasks = 0;
  for (const p of pkg.projects) {
    const { id: projectId } = await createProject(s, {
      clientId,
      name: p.name,
      description: p.description,
      objective: p.objective,
      priority: p.priority,
    });
    for (const t of p.tasks) {
      await createTask(s, { projectId, title: t.title, description: t.description, priority: t.priority });
      tasks += 1;
    }
  }

  let portal: ImportResult["portal"] = "none";
  if (pkg.portal) {
    const ref = (key: PortalAssetKey) => {
      const path = pkg.portal!.files[key];
      return path ? (fileIds.get(path) ?? null) : null;
    };
    const st = pkg.portal.settings;
    await savePortalDraft(s, clientId, {
      ...st,
      logoFileId: ref("logo"),
      logoAltFileId: ref("logoAlt"),
      faviconFileId: ref("favicon"),
      login: { ...st.login, backgroundFileId: ref("loginBackground") },
      banner: { ...st.banner, imageFileId: ref("banner") },
    });
    portal = "draft";
    if (pkg.portal.publish) {
      await publishPortal(s, clientId);
      portal = "published";
    }
    if (pkg.portal.access) {
      const slug = pkg.portal.access.slug ?? (await getClient(s, clientId)).client.slug;
      await updatePortalAccess(s, clientId, {
        slug,
        loginEnabled: pkg.portal.access.loginEnabled,
        allowGuestInvites: pkg.portal.access.allowGuestInvites,
      });
    }
  }

  return { clientId, name: pkg.client.name, files: pkg.files.length, projects: pkg.projects.length, tasks, portal };
}

import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertCan, assertInternal, type Actor, type Scope } from "@/server/authz";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { withOrg } from "@/server/db";
import { clients, files, googleDriveConnections, googleDriveFiles, projects } from "@/server/db/schema";
import { FILE_CATEGORIES } from "@/lib/validators/files";
import { env } from "@/server/env";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { recordActivity } from "./activity";
import { getVersionForDownload, maxUploadBytes, storeUpload } from "./files";

/*
 * Google Drive por pessoa (OAuth 2.0 oficial do Google).
 *
 * - Cada conexão pertence à pessoa que autorizou, dentro da organização; os
 *   tokens ficam criptografados (src/server/crypto.ts) e nunca vão ao
 *   navegador. Outra pessoa não vê nem usa a conexão.
 * - Escopo padrão `drive.file`: a plataforma só enxerga arquivos e pastas que
 *   ela mesma criou (ou que a pessoa abriu por ela). `GOOGLE_DRIVE_SCOPE=full`
 *   pede acesso amplo ao Drive — só para quem aceitar esse escopo.
 * - O Drive não é um "bucket": IDs são opacos, pastas são arquivos com um
 *   MIME próprio, há cotas e permissões. A plataforma continua guardando a
 *   cópia/metadados próprios; o Drive recebe o original exportado ou fornece
 *   o original importado (google_drive_files registra os dois lados).
 * - Nada é compartilhado nem tornado público: arquivos criados ficam
 *   privados na conta da pessoa.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_NAME = "Aragonez Builder";
const STATE_TTL_MS = 15 * 60 * 1000;
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,iconLink,thumbnailLink,parents";

export const SCOPE_FILE = "https://www.googleapis.com/auth/drive.file";
export const SCOPE_FULL = "https://www.googleapis.com/auth/drive";
export const ORGANIZE_OPTIONS = ["none", "client", "client_project", "client_project_year"] as const;
export type OrganizeBy = (typeof ORGANIZE_OPTIONS)[number];
export const ORGANIZE_LABEL: Record<OrganizeBy, string> = {
  none: "Tudo na pasta padrão",
  client: "Pasta por cliente",
  client_project: "Pasta por cliente e projeto",
  client_project_year: "Pasta por cliente, projeto e ano",
};

export class DriveError extends AppError {
  constructor(
    message: string,
    readonly kind: "config" | "auth" | "rate_limit" | "quota" | "not_found" | "unavailable" | "bad_request",
  ) {
    super(message, kind === "not_found" ? "not_found" : kind === "auth" ? "forbidden" : "conflict");
    this.name = "DriveError";
  }
}

/* ------------------------------------------------------------------ */
/* Configuração e estado assinado                                      */
/* ------------------------------------------------------------------ */

export function googleDriveConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${env.APP_URL.replace(/\/$/, "")}/api/integrations/google-drive/callback`,
    scopes: ["openid", "email", env.GOOGLE_DRIVE_SCOPE === "full" ? SCOPE_FULL : SCOPE_FILE],
  };
}

function requireConfig() {
  const cfg = googleDriveConfig();
  if (!cfg) {
    throw new DriveError(
      "O Google Drive não está configurado neste servidor (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET). Veja docs/GOOGLE-DRIVE.md.",
      "config",
    );
  }
  return cfg;
}

type StateClaims = { org: string; userId: string; ts: number; nonce: string };

function sign(payload: string) {
  return createHmac("sha256", `gdrive-state:${env.BETTER_AUTH_SECRET}`).update(payload).digest("base64url");
}

/** Estado assinado e preso à pessoa: protege o retorno do Google contra falsificação (CSRF). */
export function signDriveState(c: Omit<StateClaims, "ts" | "nonce">, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ ...c, ts: now, nonce: randomBytes(9).toString("base64url") } satisfies StateClaims),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyDriveState(state: string, userId: string, now = Date.now()): StateClaims | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StateClaims;
    if (c.userId !== userId || typeof c.ts !== "number" || now - c.ts > STATE_TTL_MS || c.ts > now + 60_000)
      return null;
    return c;
  } catch {
    return null;
  }
}

/** Endereço de autorização no Google para a pessoa conectar a própria conta. */
export function googleDriveConnectUrl(s: Scope) {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const cfg = requireConfig();
  const qs = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signDriveState({ org: s.actor.orgSlug, userId: s.actor.userId }),
  });
  return `${AUTH_URL}?${qs}`;
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const cfg = requireConfig();
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DriveError("Não foi possível falar com o Google (rede ou tempo esgotado).", "unavailable");
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    if (body.error === "invalid_grant") throw new DriveError("A autorização do Google venceu ou foi revogada.", "auth");
    throw new DriveError(`O Google recusou a autorização (${body.error ?? res.status}).`, "bad_request");
  }
  return body;
}

export async function exchangeDriveCode(code: string) {
  const cfg = requireConfig();
  const t = await tokenRequest({ grant_type: "authorization_code", redirect_uri: cfg.redirectUri, code });
  return {
    accessToken: t.access_token!,
    refreshToken: t.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
    scopes: (t.scope ?? "").split(" ").filter(Boolean),
  };
}

async function fetchAccount(accessToken: string) {
  let res: Response;
  try {
    res = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new DriveError("Não foi possível confirmar a conta Google.", "unavailable");
  }
  if (!res.ok) throw new DriveError("Não foi possível confirmar a conta Google.", "auth");
  const info = (await res.json()) as { sub?: string; email?: string };
  if (!info.sub) throw new DriveError("O Google não devolveu a identificação da conta.", "bad_request");
  return { sub: info.sub, email: info.email ?? null };
}

type Conn = typeof googleDriveConnections.$inferSelect;

async function myConnection(s: Scope): Promise<Conn | null> {
  const [row] = await s.db
    .select()
    .from(googleDriveConnections)
    .where(eq(googleDriveConnections.userId, s.actor.userId));
  return row ?? null;
}

async function requireConnection(s: Scope): Promise<Conn> {
  assertInternal(s.actor);
  assertCan(s.actor, "files.write");
  const conn = await myConnection(s);
  if (!conn) throw new DriveError("Conecte a sua conta Google em Meu perfil → Armazenamento e integrações.", "auth");
  return conn;
}

async function markReauth(s: Scope, conn: Conn, message: string) {
  await s.db
    .update(googleDriveConnections)
    .set({ status: "reauth_required", lastError: message, lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(googleDriveConnections.id, conn.id));
}

/** Token de acesso válido: renova com o refresh token quando está vencendo. */
async function accessTokenFor(s: Scope, conn: Conn): Promise<string> {
  const current = decryptSecret(conn.accessTokenEnc);
  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? 0;
  if (current && expiresAt - Date.now() > 60_000) return current;
  const refresh = conn.refreshTokenEnc ? decryptSecret(conn.refreshTokenEnc) : null;
  if (!refresh) {
    await markReauth(s, conn, "Sem token de renovação: autorize de novo.");
    throw new DriveError("A autorização do Google venceu. Conecte a conta de novo.", "auth");
  }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
    const expires = new Date(Date.now() + (t.expires_in ?? 3600) * 1000);
    await s.db
      .update(googleDriveConnections)
      .set({
        accessTokenEnc: encryptSecret(t.access_token!),
        accessTokenExpiresAt: expires,
        status: "connected",
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(googleDriveConnections.id, conn.id));
    return t.access_token!;
  } catch (err) {
    if (err instanceof DriveError && err.kind === "auth") await markReauth(s, conn, err.message);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Chamadas à API do Drive                                             */
/* ------------------------------------------------------------------ */

type DriveFile = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  iconLink?: string;
  thumbnailLink?: string;
  parents?: string[];
};

async function driveFail(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
  };
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const message = (body.error?.message ?? "").slice(0, 200);
  if (res.status === 401) throw new DriveError("A autorização do Google venceu ou foi revogada.", "auth");
  if (res.status === 403 && /storageQuotaExceeded|quotaExceeded/i.test(reason)) {
    throw new DriveError("O Google Drive desta conta está sem espaço.", "quota");
  }
  if (res.status === 429 || (res.status === 403 && /rateLimit|userRateLimit/i.test(reason))) {
    throw new DriveError("O Google limitou as chamadas por enquanto. Tente de novo em instantes.", "rate_limit");
  }
  if (res.status === 403)
    throw new DriveError(`O Google não permitiu ${what}${message ? `: ${message}` : "."}`, "auth");
  if (res.status === 404) throw new DriveError("Arquivo ou pasta não encontrado no Google Drive.", "not_found");
  if (res.status >= 500) throw new DriveError(`O Google Drive está indisponível (${res.status}).`, "unavailable");
  throw new DriveError(
    `O Google Drive recusou ${what} (${res.status})${message ? `: ${message}` : "."}`,
    "bad_request",
  );
}

async function driveFetch(s: Scope, conn: Conn, url: string, init: RequestInit, what: string): Promise<Response> {
  const token = await accessTokenFor(s, conn);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DriveError("Não foi possível falar com o Google Drive (rede ou tempo esgotado).", "unavailable");
  }
  if (res.status === 401) await markReauth(s, conn, "Token recusado pelo Google.");
  if (!res.ok) await driveFail(res, what);
  return res;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function listFiles(
  s: Scope,
  conn: Conn,
  o: { folderId?: string | null; query?: string | null; pageToken?: string | null; foldersOnly?: boolean },
) {
  const parts = ["trashed = false"];
  if (o.folderId) parts.push(`'${q(o.folderId)}' in parents`);
  if (o.foldersOnly) parts.push(`mimeType = '${FOLDER_MIME}'`);
  if (o.query?.trim()) parts.push(`name contains '${q(o.query.trim())}'`);
  const qs = new URLSearchParams({
    q: parts.join(" and "),
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    orderBy: "folder,modifiedTime desc,name",
    pageSize: "50",
    spaces: "drive",
  });
  if (o.pageToken) qs.set("pageToken", o.pageToken);
  const res = await driveFetch(s, conn, `${DRIVE}/files?${qs}`, { method: "GET" }, "listar arquivos");
  return (await res.json()) as { nextPageToken?: string; files?: DriveFile[] };
}

async function getFile(s: Scope, conn: Conn, id: string): Promise<DriveFile> {
  const res = await driveFetch(
    s,
    conn,
    `${DRIVE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FILE_FIELDS)}`,
    { method: "GET" },
    "ler o arquivo",
  );
  return (await res.json()) as DriveFile;
}

async function createFolder(s: Scope, conn: Conn, name: string, parentId: string | null): Promise<DriveFile> {
  const res = await driveFetch(
    s,
    conn,
    `${DRIVE}/files?fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
    },
    "criar a pasta",
  );
  return (await res.json()) as DriveFile;
}

/** Pasta com este nome dentro do pai (cria se não existir). */
async function ensureFolder(s: Scope, conn: Conn, name: string, parentId: string | null): Promise<DriveFile> {
  const parts = ["trashed = false", `mimeType = '${FOLDER_MIME}'`, `name = '${q(name)}'`];
  if (parentId) parts.push(`'${q(parentId)}' in parents`);
  const qs = new URLSearchParams({ q: parts.join(" and "), fields: `files(${FILE_FIELDS})`, pageSize: "5" });
  const res = await driveFetch(s, conn, `${DRIVE}/files?${qs}`, { method: "GET" }, "procurar a pasta");
  const found = ((await res.json()) as { files?: DriveFile[] }).files?.[0];
  return found ?? createFolder(s, conn, name, parentId);
}

async function uploadFile(
  s: Scope,
  conn: Conn,
  o: { name: string; mimeType: string; buffer: Buffer; parentId: string | null },
): Promise<DriveFile> {
  const boundary = `aragonez-${randomBytes(12).toString("hex")}`;
  const metadata = JSON.stringify({ name: o.name, ...(o.parentId ? { parents: [o.parentId] } : {}) });
  const head = Buffer.from(
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\ncontent-type: ${o.mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([head, o.buffer, tail]);
  const res = await driveFetch(
    s,
    conn,
    `${UPLOAD}?uploadType=multipart&fields=${encodeURIComponent(FILE_FIELDS)}`,
    {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}`, "content-length": String(body.length) },
      body: new Uint8Array(body),
    },
    "enviar o arquivo",
  );
  return (await res.json()) as DriveFile;
}

async function downloadFile(s: Scope, conn: Conn, id: string, limit: number): Promise<Buffer> {
  const res = await driveFetch(
    s,
    conn,
    `${DRIVE}/files/${encodeURIComponent(id)}?alt=media`,
    { method: "GET" },
    "baixar o arquivo",
  );
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > limit) throw new ValidationError("O arquivo é maior que o limite de envio da organização.");
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Conexão: concluir, testar, desconectar, configurar                  */
/* ------------------------------------------------------------------ */

/** Depois do retorno do Google: troca o código, confirma a conta e guarda os tokens criptografados. */
export async function completeGoogleDriveConnection(actor: Actor, code: string) {
  assertInternal(actor);
  assertCan(actor, "files.write");
  const cfg = requireConfig();
  const t = await exchangeDriveCode(code);
  const needed = cfg.scopes.find((sc) => sc.startsWith("https://www.googleapis.com/auth/drive"))!;
  if (!t.scopes.some((sc) => sc === needed || (needed === SCOPE_FILE && sc === SCOPE_FULL))) {
    throw new DriveError("A permissão de acesso ao Drive não foi concedida. Marque-a na tela do Google.", "auth");
  }
  const account = await fetchAccount(t.accessToken);
  return withOrg(actor.orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(googleDriveConnections)
      .where(eq(googleDriveConnections.userId, actor.userId));
    const values = {
      googleAccountId: account.sub,
      email: account.email,
      accessTokenEnc: encryptSecret(t.accessToken),
      // Sem refresh token novo (reautorização sem "consent"), mantém o anterior.
      refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken) : (existing?.refreshTokenEnc ?? null),
      accessTokenExpiresAt: t.expiresAt,
      scopes: t.scopes,
      status: "connected" as const,
      lastError: null,
      lastCheckedAt: new Date(),
    };
    if (existing) {
      await tx
        .update(googleDriveConnections)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(googleDriveConnections.id, existing.id));
    } else {
      await tx.insert(googleDriveConnections).values({ organizationId: actor.orgId, userId: actor.userId, ...values });
    }
    return { email: account.email };
  });
}

export type DriveStatus = {
  configured: boolean;
  connected: boolean;
  status: Conn["status"] | null;
  email: string | null;
  scopes: string[];
  broadScope: boolean;
  lastError: string | null;
  lastCheckedAt: Date | null;
  rootFolderId: string | null;
  defaultFolderId: string | null;
  defaultFolderName: string | null;
  organizeBy: OrganizeBy;
  preferredDestination: "platform" | "drive";
};

export async function googleDriveStatus(s: Scope): Promise<DriveStatus> {
  assertInternal(s.actor);
  const conn = await myConnection(s);
  return {
    configured: !!googleDriveConfig(),
    connected: !!conn,
    status: conn?.status ?? null,
    email: conn?.email ?? null,
    scopes: conn?.scopes ?? [],
    broadScope: conn?.scopes.includes(SCOPE_FULL) ?? false,
    lastError: conn?.lastError ?? null,
    lastCheckedAt: conn?.lastCheckedAt ?? null,
    rootFolderId: conn?.rootFolderId ?? null,
    defaultFolderId: conn?.defaultFolderId ?? null,
    defaultFolderName: conn?.defaultFolderName ?? null,
    organizeBy: (ORGANIZE_OPTIONS as readonly string[]).includes(conn?.organizeBy ?? "")
      ? (conn!.organizeBy as OrganizeBy)
      : "client_project",
    preferredDestination: conn?.preferredDestination === "drive" ? "drive" : "platform",
  };
}

/** Chamada real (about + pasta raiz): confirma que o acesso funciona e atualiza o estado. */
export async function testGoogleDrive(s: Scope) {
  const conn = await requireConnection(s);
  try {
    const res = await driveFetch(
      s,
      conn,
      `${DRIVE}/about?fields=${encodeURIComponent("user(emailAddress),storageQuota(limit,usage)")}`,
      { method: "GET" },
      "consultar a conta",
    );
    const about = (await res.json()) as {
      user?: { emailAddress?: string };
      storageQuota?: { limit?: string; usage?: string };
    };
    await s.db
      .update(googleDriveConnections)
      .set({
        status: "connected",
        lastError: null,
        lastCheckedAt: new Date(),
        email: about.user?.emailAddress ?? conn.email,
        updatedAt: new Date(),
      })
      .where(eq(googleDriveConnections.id, conn.id));
    return {
      ok: true as const,
      email: about.user?.emailAddress ?? conn.email,
      quota: about.storageQuota
        ? { limit: Number(about.storageQuota.limit ?? 0) || null, usage: Number(about.storageQuota.usage ?? 0) }
        : null,
    };
  } catch (err) {
    const message = err instanceof AppError ? err.message : "Falha ao consultar o Google Drive.";
    await s.db
      .update(googleDriveConnections)
      .set({
        status: err instanceof DriveError && err.kind === "auth" ? "reauth_required" : "error",
        lastError: message,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(googleDriveConnections.id, conn.id));
    return { ok: false as const, error: message };
  }
}

/** Revoga o token no Google (melhor esforço) e apaga a conexão e os registros dela. */
export async function disconnectGoogleDrive(s: Scope) {
  const conn = await requireConnection(s);
  const token = conn.refreshTokenEnc ? decryptSecret(conn.refreshTokenEnc) : decryptSecret(conn.accessTokenEnc);
  if (token) {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
  await s.db.delete(googleDriveConnections).where(eq(googleDriveConnections.id, conn.id));
  await recordActivity(s, {
    action: "google_drive_disconnected",
    entityType: "user",
    entityId: s.actor.userId,
    summary: "Conta Google desconectada do Drive",
    metadata: { email: conn.email },
    event: false,
  });
}

export const driveSettingsInput = z.object({
  preferredDestination: z.enum(["platform", "drive"]).optional(),
  organizeBy: z.enum(ORGANIZE_OPTIONS).optional(),
  /** null = voltar à pasta raiz da plataforma. */
  defaultFolderId: z.string().trim().max(200).nullable().optional(),
});

export async function updateGoogleDriveSettings(s: Scope, raw: z.input<typeof driveSettingsInput>) {
  const conn = await requireConnection(s);
  const data = driveSettingsInput.parse(raw);
  const patch: Partial<typeof googleDriveConnections.$inferInsert> = {};
  if (data.preferredDestination) patch.preferredDestination = data.preferredDestination;
  if (data.organizeBy) patch.organizeBy = data.organizeBy;
  if (data.defaultFolderId !== undefined) {
    if (data.defaultFolderId) {
      const folder = await getFile(s, conn, data.defaultFolderId);
      if (folder.mimeType !== FOLDER_MIME) throw new ValidationError("Escolha uma pasta.");
      patch.defaultFolderId = folder.id;
      patch.defaultFolderName = folder.name;
    } else {
      patch.defaultFolderId = null;
      patch.defaultFolderName = null;
    }
  }
  await s.db
    .update(googleDriveConnections)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(googleDriveConnections.id, conn.id));
}

/** Garante a pasta raiz "Aragonez Builder" na conta e guarda o id. */
export async function ensureRootFolder(s: Scope): Promise<{ id: string; name: string }> {
  const conn = await requireConnection(s);
  if (conn.rootFolderId) {
    try {
      const f = await getFile(s, conn, conn.rootFolderId);
      if (f.mimeType === FOLDER_MIME) return { id: f.id, name: f.name };
    } catch (err) {
      if (!(err instanceof DriveError && err.kind === "not_found")) throw err;
    }
  }
  const folder = await ensureFolder(s, conn, ROOT_FOLDER_NAME, null);
  await s.db
    .update(googleDriveConnections)
    .set({ rootFolderId: folder.id, updatedAt: new Date() })
    .where(eq(googleDriveConnections.id, conn.id));
  return { id: folder.id, name: folder.name };
}

/* ------------------------------------------------------------------ */
/* Navegar, enviar e importar                                          */
/* ------------------------------------------------------------------ */

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  sizeBytes: number | null;
  modifiedAt: string | null;
  webViewLink: string | null;
  iconLink: string | null;
  thumbnailLink: string | null;
};

function entry(f: DriveFile): DriveEntry {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType ?? "application/octet-stream",
    isFolder: f.mimeType === FOLDER_MIME,
    sizeBytes: f.size ? Number(f.size) : null,
    modifiedAt: f.modifiedTime ?? null,
    webViewLink: f.webViewLink ?? null,
    iconLink: f.iconLink ?? null,
    thumbnailLink: f.thumbnailLink ?? null,
  };
}

export const driveListInput = z.object({
  /** Ausente = pasta raiz da plataforma. */
  folderId: z.string().trim().max(200).nullish(),
  query: z.string().trim().max(100).nullish(),
  pageToken: z.string().trim().max(500).nullish(),
  foldersOnly: z.boolean().optional(),
});

/** Conteúdo de uma pasta (ou busca por nome) no Drive da pessoa. */
export async function listDriveFolder(s: Scope, raw: z.input<typeof driveListInput>) {
  const data = driveListInput.parse(raw);
  const conn = await requireConnection(s);
  const folderId = data.folderId ?? (data.query ? null : (await ensureRootFolder(s)).id);
  const page = await listFiles(s, conn, {
    folderId,
    query: data.query,
    pageToken: data.pageToken,
    foldersOnly: data.foldersOnly,
  });
  const folder = folderId ? await getFile(s, conn, folderId) : null;
  return {
    folder: folder ? { id: folder.id, name: folder.name, parentId: folder.parents?.[0] ?? null } : null,
    entries: (page.files ?? []).map(entry),
    nextPageToken: page.nextPageToken ?? null,
  };
}

export async function createDriveFolder(s: Scope, raw: { name: string; parentId?: string | null }) {
  const name = z.string().trim().min(1).max(120).parse(raw.name);
  const conn = await requireConnection(s);
  const parentId = raw.parentId ?? (await ensureRootFolder(s)).id;
  return entry(await createFolder(s, conn, name, parentId));
}

/** Pasta de destino conforme a organização escolhida (cliente/projeto/ano), criando o que faltar. */
async function destinationFolder(
  s: Scope,
  conn: Conn,
  links: { clientId: string | null; projectId: string | null },
  explicitFolderId?: string | null,
): Promise<string> {
  if (explicitFolderId) return explicitFolderId;
  const base = conn.defaultFolderId ?? (await ensureRootFolder(s)).id;
  const organize = (conn.organizeBy || "client_project") as OrganizeBy;
  if (organize === "none") return base;
  let current = base;
  if (links.clientId) {
    const [c] = await s.db.select({ name: clients.name }).from(clients).where(eq(clients.id, links.clientId));
    if (c) current = (await ensureFolder(s, conn, c.name, current)).id;
  }
  if ((organize === "client_project" || organize === "client_project_year") && links.projectId) {
    const [p] = await s.db.select({ name: projects.name }).from(projects).where(eq(projects.id, links.projectId));
    if (p) current = (await ensureFolder(s, conn, p.name, current)).id;
  }
  if (organize === "client_project_year") {
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(
      new Date(),
    );
    current = (await ensureFolder(s, conn, year, current)).id;
  }
  return current;
}

export const exportToDriveInput = z.object({
  versionId: z.uuid(),
  /** Pasta escolhida na hora (senão, pasta padrão + organização). */
  folderId: z.string().trim().max(200).nullish(),
});

/** Envia uma versão de arquivo da plataforma para o Drive da pessoa (o arquivo continua na plataforma). */
export async function exportVersionToDrive(s: Scope, raw: z.input<typeof exportToDriveInput>) {
  const data = exportToDriveInput.parse(raw);
  const conn = await requireConnection(s);
  const version = await getVersionForDownload(s, data.versionId);
  const links = await fileLinks(s, version.fileId);
  const buffer = await getStorage().get(version.storageKey);
  const folderId = await destinationFolder(s, conn, links, data.folderId);
  let uploaded: DriveFile;
  try {
    uploaded = await uploadFile(s, conn, {
      name: version.originalName,
      mimeType: version.mimeType || "application/octet-stream",
      buffer,
      parentId: folderId,
    });
  } catch (err) {
    await s.db
      .insert(googleDriveFiles)
      .values({
        organizationId: s.actor.orgId,
        connectionId: conn.id,
        userId: s.actor.userId,
        direction: "export",
        driveFileId: `failed-${data.versionId}-${Date.now()}`,
        driveFolderId: folderId,
        name: version.originalName,
        mimeType: version.mimeType,
        fileId: version.fileId,
        fileVersionId: version.id,
        status: "failed",
        lastError: err instanceof AppError ? err.message : "Falha no envio.",
      })
      .catch(() => undefined);
    throw err;
  }
  await s.db
    .insert(googleDriveFiles)
    .values({
      organizationId: s.actor.orgId,
      connectionId: conn.id,
      userId: s.actor.userId,
      direction: "export",
      driveFileId: uploaded.id,
      driveFolderId: folderId,
      name: uploaded.name,
      mimeType: uploaded.mimeType ?? version.mimeType,
      sizeBytes: uploaded.size ? Number(uploaded.size) : buffer.length,
      webViewLink: uploaded.webViewLink ?? null,
      fileId: version.fileId,
      fileVersionId: version.id,
      status: "ok",
    })
    .onConflictDoNothing();
  await recordActivity(s, {
    action: "google_drive_exported",
    entityType: "file",
    entityId: version.fileId,
    summary: `${version.originalName} enviado ao Google Drive`,
    metadata: { driveFileId: uploaded.id, folderId },
    event: false,
  });
  return { driveFileId: uploaded.id, name: uploaded.name, webViewLink: uploaded.webViewLink ?? null, folderId };
}

async function fileLinks(s: Scope, fileId: string) {
  const [row] = await s.db
    .select({ clientId: files.clientId, projectId: files.projectId })
    .from(files)
    .where(eq(files.id, fileId));
  return { clientId: row?.clientId ?? null, projectId: row?.projectId ?? null };
}

export const importFromDriveInput = z.object({
  driveFileId: z.string().trim().min(1).max(200),
  clientId: z.uuid().nullish(),
  projectId: z.uuid().nullish(),
  folderId: z.uuid().nullish(),
  category: z.enum(FILE_CATEGORIES).optional(),
});

/** Traz um arquivo do Drive para a plataforma (cópia própria, origem "drive"), validando tipo e tamanho. */
export async function importFromDrive(s: Scope, raw: z.input<typeof importFromDriveInput>) {
  const data = importFromDriveInput.parse(raw);
  const conn = await requireConnection(s);
  const meta = await getFile(s, conn, data.driveFileId);
  if (meta.mimeType === FOLDER_MIME) throw new ValidationError("Escolha um arquivo, não uma pasta.");
  if (meta.mimeType?.startsWith("application/vnd.google-apps.")) {
    throw new ValidationError("Documentos nativos do Google (Docs, Sheets, Slides) precisam ser exportados antes.");
  }
  const limit = maxUploadBytes(s);
  if (meta.size && Number(meta.size) > limit) {
    throw new ValidationError("O arquivo é maior que o limite de envio da organização.");
  }
  const buffer = await downloadFile(s, conn, meta.id, limit);
  const stored = await storeUpload(
    s,
    { buffer, originalName: meta.name },
    {
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      folderId: data.folderId ?? null,
      category: data.category ?? "general",
      note: "Importado do Google Drive",
      source: "drive",
    },
  );
  await s.db
    .insert(googleDriveFiles)
    .values({
      organizationId: s.actor.orgId,
      connectionId: conn.id,
      userId: s.actor.userId,
      direction: "import",
      driveFileId: meta.id,
      driveFolderId: meta.parents?.[0] ?? null,
      name: meta.name,
      mimeType: meta.mimeType ?? null,
      sizeBytes: buffer.length,
      webViewLink: meta.webViewLink ?? null,
      fileId: stored.fileId,
      fileVersionId: stored.versionId,
      status: "ok",
    })
    .onConflictDoNothing();
  return { ...stored, name: meta.name };
}

/** Registros do Drive ligados a um arquivo da plataforma (origem/cópias), só os da pessoa. */
export async function driveLinksForFile(s: Scope, fileId: string) {
  assertInternal(s.actor);
  return s.db
    .select({
      id: googleDriveFiles.id,
      direction: googleDriveFiles.direction,
      driveFileId: googleDriveFiles.driveFileId,
      name: googleDriveFiles.name,
      webViewLink: googleDriveFiles.webViewLink,
      status: googleDriveFiles.status,
      lastError: googleDriveFiles.lastError,
      fileVersionId: googleDriveFiles.fileVersionId,
      createdAt: googleDriveFiles.createdAt,
    })
    .from(googleDriveFiles)
    .where(and(eq(googleDriveFiles.fileId, fileId), eq(googleDriveFiles.userId, s.actor.userId)))
    .orderBy(desc(googleDriveFiles.createdAt));
}

export function isDriveError(err: unknown): err is DriveError {
  return err instanceof DriveError;
}

export { ForbiddenError, NotFoundError };

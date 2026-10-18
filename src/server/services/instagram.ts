import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ApiPost, PostFormat } from "@/lib/brand-radar";
import { inOrg, type Actor, type Scope } from "@/server/authz";
import { decryptSecret, encryptSecret } from "@/server/crypto";
import { brandRadarConnections } from "@/server/db/schema";
import { env } from "@/server/env";
import { AppError, ValidationError } from "@/server/errors";
import { recordActivity } from "./activity";
import { assertBrandManage, assertBrandRead, loadProfile } from "./brand-radar";

/*
 * Conexão oficial com o Instagram ("Instagram API com login do Instagram",
 * da Meta). Só funciona com conta profissional (comercial ou criador de
 * conteúdo) e com o app configurado no servidor (META_APP_ID e
 * META_APP_SECRET). Nunca pedimos senha, não fazemos raspagem de páginas nem
 * automação de login: a pessoa autoriza no próprio Instagram e a Meta devolve
 * um token, guardado criptografado. A conexão só LÊ dados (perfil e
 * publicações com curtidas e comentários); nada é publicado ou alterado.
 */

export class InstagramError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
    this.name = "InstagramError";
  }
}

/** Permissão mínima: perfil, publicações e contagens públicas da própria conta. */
export const INSTAGRAM_SCOPES = ["instagram_business_basic"] as const;
const AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";
const STATE_TTL_MS = 10 * 60 * 1000;
/** A Meta só renova tokens com mais de 24 h; renovamos quando faltam menos de 7 dias. */
const REFRESH_BEFORE_MS = 7 * 24 * 3600 * 1000;

export function instagramConfig() {
  if (!env.META_APP_ID || !env.META_APP_SECRET) return null;
  return {
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    version: env.META_GRAPH_VERSION,
    redirectUri: `${env.APP_URL.replace(/\/$/, "")}/api/brand-radar/instagram/callback`,
  };
}

function requireConfig() {
  const cfg = instagramConfig();
  if (!cfg) {
    throw new InstagramError(
      "A integração oficial com o Instagram não está configurada neste servidor. Use a entrada manual ou peça ao administrador para configurar o app da Meta.",
    );
  }
  return cfg;
}

/* ------------------------------------------------------------------ */
/* Estado assinado (protege o retorno da Meta contra falsificação)      */
/* ------------------------------------------------------------------ */

type StateClaims = { org: string; profileId: string; userId: string; ts: number; nonce: string };

function sign(payload: string) {
  return createHmac("sha256", `ig-state:${env.BETTER_AUTH_SECRET}`).update(payload).digest("base64url");
}

export function signState(c: Omit<StateClaims, "ts" | "nonce">, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ ...c, ts: now, nonce: randomBytes(9).toString("base64url") } satisfies StateClaims),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string, userId: string, now = Date.now()): StateClaims | null {
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

/** Endereço de autorização no Instagram (a pessoa entra com a conta profissional do cliente). */
export async function instagramConnectUrl(s: Scope, profileId: string, orgSlug: string) {
  assertBrandManage(s);
  const cfg = requireConfig();
  const { profile } = await loadProfile(s, profileId);
  if (profile.kind !== "own") throw new ValidationError("Só o perfil do próprio cliente pode ser conectado.");
  const qs = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","),
    state: signState({ org: orgSlug, profileId: profile.id, userId: s.actor.userId }),
  });
  return `${AUTHORIZE_URL}?${qs}`;
}

/* ------------------------------------------------------------------ */
/* Chamadas à API da Meta                                               */
/* ------------------------------------------------------------------ */

type MetaError = { error?: { message?: string; type?: string; code?: number; error_subtype?: number } };

/** Erros da Meta viram mensagens simples; o código 190 indica token vencido ou revogado. */
async function metaJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & MetaError & { error_message?: string; code?: number };
  if (!res.ok || body.error) {
    const code = body.error?.code ?? body.code ?? res.status;
    if (code === 190 || res.status === 401) throw new TokenInvalidError();
    if (code === 4 || code === 17 || code === 32 || res.status === 429)
      throw new InstagramError("O Instagram limitou as consultas por enquanto. Tente de novo mais tarde.");
    const message = body.error?.message ?? body.error_message ?? `Erro ${res.status}`;
    throw new InstagramError(`O Instagram recusou o pedido: ${message.slice(0, 200)}`);
  }
  return body;
}

export class TokenInvalidError extends InstagramError {
  constructor() {
    super("A autorização do Instagram venceu ou foi revogada. Conecte a conta de novo.");
    this.name = "TokenInvalidError";
  }
}

export async function exchangeCode(code: string) {
  const cfg = requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
      code,
    }),
  });
  // A Meta já respondeu nos dois formatos: { data: [{...}] } e { access_token, user_id, permissions }.
  const body = await metaJson<{
    data?: { access_token: string; user_id: string | number; permissions?: string | string[] }[];
    access_token?: string;
    user_id?: string | number;
    permissions?: string | string[];
  }>(res);
  const item = body.data?.[0] ?? body;
  if (!item.access_token || item.user_id === undefined)
    throw new InstagramError("O Instagram não devolveu a autorização.");
  const perms = item.permissions ?? [];
  const short = {
    accessToken: item.access_token,
    userId: String(item.user_id),
    scopes: (Array.isArray(perms) ? perms : perms.split(",")).map((x) => x.trim()).filter(Boolean),
  };
  // Troca pelo token de longa duração (cerca de 60 dias).
  const qs = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: cfg.appSecret,
    access_token: short.accessToken,
  });
  const long = await metaJson<{ access_token: string; expires_in?: number }>(
    await fetch(`${GRAPH}/access_token?${qs}`),
  );
  return { ...short, accessToken: long.access_token, expiresIn: long.expires_in ?? null };
}

export async function refreshToken(token: string) {
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const r = await metaJson<{ access_token: string; expires_in?: number }>(
    await fetch(`${GRAPH}/refresh_access_token?${qs}`),
  );
  return { accessToken: r.access_token, expiresIn: r.expires_in ?? null };
}

export type InstagramProfile = {
  user_id?: string;
  id?: string;
  username: string;
  name?: string | null;
  account_type?: string | null;
  profile_picture_url?: string | null;
  followers_count?: number | null;
  follows_count?: number | null;
  media_count?: number | null;
  biography?: string | null;
  website?: string | null;
};

const PROFILE_FIELDS =
  "user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count";
const MEDIA_FIELDS = "id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink";

export async function fetchProfile(token: string, version: string): Promise<InstagramProfile> {
  const base = await metaJson<InstagramProfile>(
    await fetch(`${GRAPH}/${version}/me?${new URLSearchParams({ fields: PROFILE_FIELDS, access_token: token })}`),
  );
  // Bio e site nem sempre estão disponíveis para esta API: se falhar, ficam como "não informado".
  try {
    const extra = await metaJson<{ biography?: string; website?: string }>(
      await fetch(
        `${GRAPH}/${version}/me?${new URLSearchParams({ fields: "biography,website", access_token: token })}`,
      ),
    );
    return { ...base, biography: extra.biography ?? null, website: extra.website ?? null };
  } catch (err) {
    if (err instanceof TokenInvalidError) throw err;
    return { ...base, biography: null, website: null };
  }
}

export function mediaFormat(mediaType: string | undefined, productType: string | undefined): PostFormat {
  if (mediaType === "CAROUSEL_ALBUM") return "carousel";
  if (mediaType === "VIDEO" || productType === "REELS") return "video";
  return "image";
}

export async function fetchMedia(token: string, version: string, limit = 25): Promise<ApiPost[]> {
  const body = await metaJson<{
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
      permalink?: string;
    }[];
  }>(
    await fetch(
      `${GRAPH}/${version}/me/media?${new URLSearchParams({ fields: MEDIA_FIELDS, limit: String(limit), access_token: token })}`,
    ),
  );
  return (body.data ?? [])
    .filter((m) => m.media_product_type !== "STORY")
    .map((m) => ({
      id: m.id,
      format: mediaFormat(m.media_type, m.media_product_type),
      caption: (m.caption ?? "").slice(0, 2200),
      timestamp: m.timestamp ?? null,
      // Contagens que a API não devolve (ex.: curtidas ocultas) ficam nulas, nunca zero.
      likes: typeof m.like_count === "number" ? m.like_count : null,
      comments: typeof m.comments_count === "number" ? m.comments_count : null,
      permalink: m.permalink ?? null,
    }));
}

/** Leitura de perfil + publicações, no formato gravado em lastSync (com a data da coleta). */
export async function readAccount(token: string, version: string, now = new Date()) {
  const profile = await fetchProfile(token, version);
  const media = await fetchMedia(token, version);
  return {
    fetchedAt: now.toISOString(),
    profile: {
      username: profile.username,
      name: profile.name ?? null,
      accountType: profile.account_type ?? null,
      biography: profile.biography ?? null,
      website: profile.website ?? null,
      followers_count: profile.followers_count ?? null,
      follows_count: profile.follows_count ?? null,
      media_count: profile.media_count ?? null,
    },
    media,
  };
}

/* ------------------------------------------------------------------ */
/* Conectar, sincronizar e desconectar                                  */
/* ------------------------------------------------------------------ */

/** Retorno da Meta: troca o código, confere a conta e guarda o token criptografado. */
export async function completeInstagramConnection(actor: Actor, o: { profileId: string; code: string }) {
  const cfg = requireConfig();
  const profile = await inOrg(actor, async (s) => {
    assertBrandManage(s);
    return (await loadProfile(s, o.profileId)).profile;
  });
  const token = await exchangeCode(o.code);
  const snapshot = await readAccount(token.accessToken, cfg.version);
  if (snapshot.profile.username.toLowerCase() !== profile.handle) {
    throw new InstagramError(
      `A conta autorizada (@${snapshot.profile.username}) não é a do perfil @${profile.handle}. Entre no Instagram com a conta certa e tente de novo.`,
    );
  }
  const expiresAt = token.expiresIn ? new Date(Date.now() + token.expiresIn * 1000) : null;
  await inOrg(actor, async (s) => {
    const values = {
      igUserId: token.userId,
      username: snapshot.profile.username,
      accountType: snapshot.profile.accountType,
      accessTokenEnc: encryptSecret(token.accessToken),
      tokenExpiresAt: expiresAt,
      scopes: token.scopes.length ? token.scopes : [...INSTAGRAM_SCOPES],
      status: "connected",
      lastSyncAt: new Date(snapshot.fetchedAt),
      lastSync: snapshot,
      lastError: null,
      connectedByUserId: s.actor.userId,
    };
    await s.db
      .insert(brandRadarConnections)
      .values({ organizationId: s.actor.orgId, profileId: profile.id, ...values })
      .onConflictDoUpdate({ target: brandRadarConnections.profileId, set: values });
    await recordActivity(s, {
      action: "connected",
      entityType: "brand_radar_profile",
      entityId: profile.id,
      summary: `Radar de Marca: conta @${snapshot.profile.username} conectada pela API oficial do Instagram`,
      event: false,
    });
  });
  return { profileId: profile.id, username: snapshot.profile.username };
}

async function markConnection(
  actor: Actor,
  profileId: string,
  set: Partial<typeof brandRadarConnections.$inferInsert>,
) {
  await inOrg(actor, (s) =>
    s.db.update(brandRadarConnections).set(set).where(eq(brandRadarConnections.profileId, profileId)),
  );
}

/** Atualiza os dados da conta conectada (renova o token quando está perto de vencer). */
export async function syncInstagram(actor: Actor, profileId: string, now = new Date()) {
  const cfg = requireConfig();
  const conn = await inOrg(actor, async (s) => {
    assertBrandManage(s);
    await loadProfile(s, profileId);
    const [c] = await s.db.select().from(brandRadarConnections).where(eq(brandRadarConnections.profileId, profileId));
    return c ?? null;
  });
  if (!conn) throw new InstagramError("Esta conta não está conectada.");
  let token = conn.accessTokenEnc ? decryptSecret(conn.accessTokenEnc) : null;
  if (!token) {
    await markConnection(actor, profileId, { status: "error", lastError: "Token ilegível: conecte de novo." });
    throw new InstagramError("Não foi possível ler a autorização guardada. Conecte a conta de novo.");
  }
  if (conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() <= now.getTime()) {
    await markConnection(actor, profileId, { status: "expired", lastError: "A autorização venceu." });
    throw new TokenInvalidError();
  }
  const set: Partial<typeof brandRadarConnections.$inferInsert> = {};
  try {
    const age = now.getTime() - conn.updatedAt.getTime();
    if (
      conn.tokenExpiresAt &&
      conn.tokenExpiresAt.getTime() - now.getTime() < REFRESH_BEFORE_MS &&
      age > 24 * 3600 * 1000
    ) {
      const r = await refreshToken(token);
      token = r.accessToken;
      set.accessTokenEnc = encryptSecret(r.accessToken);
      if (r.expiresIn) set.tokenExpiresAt = new Date(now.getTime() + r.expiresIn * 1000);
    }
    const snapshot = await readAccount(token, cfg.version, now);
    await markConnection(actor, profileId, {
      ...set,
      status: "connected",
      username: snapshot.profile.username,
      accountType: snapshot.profile.accountType,
      lastSyncAt: now,
      lastSync: snapshot,
      lastError: null,
    });
    return { fetchedAt: snapshot.fetchedAt, posts: snapshot.media.length };
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      await markConnection(actor, profileId, { status: "expired", lastError: err.message });
    } else if (err instanceof InstagramError) {
      await markConnection(actor, profileId, { lastError: err.message });
    }
    throw err;
  }
}

/** Remove a conexão e o token guardado. Os diagnósticos já feitos continuam no histórico. */
export async function disconnectInstagram(s: Scope, profileId: string) {
  assertBrandManage(s);
  const { profile } = await loadProfile(s, profileId);
  const deleted = await s.db
    .delete(brandRadarConnections)
    .where(eq(brandRadarConnections.profileId, profile.id))
    .returning({ username: brandRadarConnections.username });
  if (deleted.length) {
    await recordActivity(s, {
      action: "disconnected",
      entityType: "brand_radar_profile",
      entityId: profile.id,
      summary: `Radar de Marca: conta @${deleted[0]!.username} desconectada`,
      event: false,
    });
  }
  return { removed: deleted.length > 0 };
}

/** Situação mostrada na tela (sem token). */
export async function instagramState(s: Scope, profileId: string, now = new Date()) {
  assertBrandRead(s);
  const configured = !!instagramConfig();
  const [c] = await s.db
    .select({
      status: brandRadarConnections.status,
      username: brandRadarConnections.username,
      tokenExpiresAt: brandRadarConnections.tokenExpiresAt,
      lastSyncAt: brandRadarConnections.lastSyncAt,
      lastError: brandRadarConnections.lastError,
    })
    .from(brandRadarConnections)
    .where(eq(brandRadarConnections.profileId, profileId));
  if (!c) return { configured, status: configured ? ("disconnected" as const) : ("not_configured" as const) };
  const expired = c.tokenExpiresAt ? c.tokenExpiresAt.getTime() <= now.getTime() : false;
  return {
    configured,
    status: expired ? ("expired" as const) : (c.status as "connected" | "expired" | "revoked" | "error"),
    username: c.username,
    tokenExpiresAt: c.tokenExpiresAt,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
  };
}

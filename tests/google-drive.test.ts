import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "@/server/crypto";
import { withOrg, withSystem } from "@/server/db";
import { fileVersions, googleDriveConnections, googleDriveFiles } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { createClient } from "@/server/services/clients";
import { storeUpload } from "@/server/services/files";
import {
  completeGoogleDriveConnection,
  createDriveFolder,
  disconnectGoogleDrive,
  DriveError,
  driveLinksForFile,
  exportVersionToDrive,
  googleDriveConnectUrl,
  googleDriveStatus,
  importFromDrive,
  listDriveFolder,
  signDriveState,
  testGoogleDrive,
  updateGoogleDriveSettings,
  verifyDriveState,
} from "@/server/services/google-drive";
import { createProject } from "@/server/services/projects";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Google Drive por pessoa com a API do Google simulada (OAuth 2.0, userinfo,
 * Drive v3: about, files.list/get/create, upload multipart, alt=media,
 * revoke). Cobre estado assinado, conexão, renovação de token, exportação com
 * organização de pastas, importação, listagem/busca, isolamento, falhas e
 * desconexão. Nenhuma chamada sai da máquina; o fluxo real depende de
 * GOOGLE_CLIENT_ID/SECRET (docs/GOOGLE-DRIVE.md).
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
type DriveFile = { id: string; name: string; mimeType: string; parents: string[]; bytes: Buffer };
const FOLDER = "application/vnd.google-apps.folder";

function installGoogleMock() {
  const state = {
    accessTokens: new Set<string>(["tok-access-1"]),
    refreshTokens: new Set<string>(["tok-refresh-1"]),
    nextAccess: "tok-access-2",
    grantScope: "openid email https://www.googleapis.com/auth/drive.file",
    files: new Map<string, DriveFile>(),
    seq: 0,
    /** Falha forçada nas chamadas ao Drive: status + reason. */
    fail: null as { status: number; reason?: string } | null,
    network: false,
    revoked: [] as string[],
  };
  const calls: { url: string; method: string; body: string | null; auth: string | null }[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const toJson = (f: DriveFile) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.mimeType === FOLDER ? undefined : String(f.bytes.length),
    modifiedTime: "2026-10-24T12:00:00Z",
    webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
    parents: f.parents,
  });
  const addFile = (f: Omit<DriveFile, "id">) => {
    const id = `gd-${++state.seq}`;
    state.files.set(id, { ...f, id });
    return state.files.get(id)!;
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const rawBody = init?.body;
    const body =
      typeof rawBody === "string"
        ? rawBody
        : rawBody instanceof Uint8Array
          ? Buffer.from(rawBody).toString("latin1")
          : rawBody instanceof URLSearchParams
            ? rawBody.toString()
            : null;
    calls.push({ url, method, body, auth });
    if (state.network) throw new Error("network down");
    const u = new URL(url);

    if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
      const p = new URLSearchParams(body ?? "");
      if (p.get("grant_type") === "authorization_code") {
        if (p.get("code") !== "code-ok") return json({ error: "invalid_grant" }, 400);
        return json({
          access_token: "tok-access-1",
          refresh_token: "tok-refresh-1",
          expires_in: 3600,
          scope: state.grantScope,
        });
      }
      if (p.get("grant_type") === "refresh_token") {
        if (!state.refreshTokens.has(p.get("refresh_token") ?? "")) return json({ error: "invalid_grant" }, 400);
        state.accessTokens.add(state.nextAccess);
        return json({ access_token: state.nextAccess, expires_in: 3600, scope: state.grantScope });
      }
      return json({ error: "unsupported" }, 400);
    }
    if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") {
      state.revoked.push(u.searchParams.get("token") ?? "");
      return json({});
    }
    if (u.host === "www.googleapis.com" && u.pathname === "/oauth2/v3/userinfo") {
      if (!state.accessTokens.has((auth ?? "").replace("Bearer ", ""))) return json({ error: "invalid" }, 401);
      return json({ sub: "google-sub-1", email: "helena@gmail.test" });
    }

    // Drive v3
    const token = (auth ?? "").replace("Bearer ", "");
    if (!state.accessTokens.has(token)) return json({ error: { message: "Invalid Credentials" } }, 401);
    if (state.fail) {
      const f = state.fail;
      return json({ error: { message: "forced", errors: [{ reason: f.reason ?? "backendError" }] } }, f.status);
    }
    if (u.pathname === "/drive/v3/about") {
      return json({
        user: { emailAddress: "helena@gmail.test" },
        storageQuota: { limit: "16106127360", usage: "1024" },
      });
    }
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const contains = /name contains '([^']+)'/.exec(q)?.[1];
      const foldersOnly = q.includes(`mimeType = '${FOLDER}'`);
      const files = [...state.files.values()].filter(
        (f) =>
          (!parent || f.parents.includes(parent)) &&
          (!name || f.name === name) &&
          (!contains || f.name.toLowerCase().includes(contains.toLowerCase())) &&
          (!foldersOnly || f.mimeType === FOLDER),
      );
      return json({ files: files.map(toJson) });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(body ?? "{}") as { name: string; mimeType: string; parents?: string[] };
      return json(
        toJson(
          addFile({ name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], bytes: Buffer.alloc(0) }),
        ),
      );
    }
    const byId = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (byId && method === "GET") {
      const f = state.files.get(decodeURIComponent(byId[1]!));
      if (!f) return json({ error: { message: "File not found" } }, 404);
      if (u.searchParams.get("alt") === "media") {
        return new Response(new Uint8Array(f.bytes), { status: 200, headers: { "content-type": f.mimeType } });
      }
      return json(toJson(f));
    }
    if (u.host === "www.googleapis.com" && u.pathname === "/upload/drive/v3/files" && method === "POST") {
      const raw = body ?? "";
      const metaMatch = /\r\n\r\n(\{[^]*?\})\r\n--/.exec(raw);
      const meta = JSON.parse(metaMatch?.[1] ?? "{}") as { name: string; parents?: string[] };
      const mime = /content-type: ([^\r\n]+)\r\n\r\n/g;
      mime.exec(raw); // metadata part
      const fileType = mime.exec(raw)?.[1] ?? "application/octet-stream";
      const start = raw.indexOf("\r\n\r\n", raw.indexOf(fileType)) + 4;
      const end = raw.lastIndexOf("\r\n--");
      const bytes = Buffer.from(raw.slice(start, end), "latin1");
      return json(toJson(addFile({ name: meta.name, mimeType: fileType, parents: meta.parents ?? [], bytes })));
    }
    throw new Error(`Chamada de rede inesperada no teste: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    state,
    calls,
    addFile,
    reset() {
      calls.length = 0;
      state.fail = null;
      state.network = false;
    },
  };
}

describe("Google Drive — estado assinado", () => {
  it("aceita só o estado assinado, da mesma pessoa e dentro do prazo", () => {
    const st = signDriveState({ org: "aurora", userId: "u1" });
    expect(verifyDriveState(st, "u1")).toMatchObject({ org: "aurora", userId: "u1" });
    expect(verifyDriveState(st, "u2")).toBeNull();
    expect(verifyDriveState(`${st}x`, "u1")).toBeNull();
    expect(verifyDriveState(st, "u1", Date.now() + 16 * 60 * 1000)).toBeNull();
  });
});

describe("Google Drive — conexão e uso", () => {
  let ctx: Ctx;
  let other: Ctx;
  let colleague: Awaited<ReturnType<typeof addMember>>;
  let mock: ReturnType<typeof installGoogleMock>;
  let clientId: string;
  let projectId: string;
  const saved = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, scope: env.GOOGLE_DRIVE_SCOPE };

  beforeAll(async () => {
    mock = installGoogleMock();
    await resetDb();
    ctx = await createOrgWithOwner("Agência Drive");
    other = await createOrgWithOwner("Agência Sem Drive");
    colleague = await addMember(ctx.org.slug, ctx.org.id, "designer");
    clientId = (await as(ctx.actor, (s) => createClient(s, { name: "Cliente Nuvem" }))).id;
    projectId = (await as(ctx.actor, (s) => createProject(s, { clientId, name: "Campanha Nuvem" }))).id;
  });

  afterAll(() => {
    env.GOOGLE_CLIENT_ID = saved.id;
    env.GOOGLE_CLIENT_SECRET = saved.secret;
    env.GOOGLE_DRIVE_SCOPE = saved.scope;
    vi.unstubAllGlobals();
  });

  beforeEach(() => mock.reset());

  it("sem credenciais do Google: a integração se declara não configurada e não gera URL", async () => {
    env.GOOGLE_CLIENT_ID = undefined;
    env.GOOGLE_CLIENT_SECRET = undefined;
    expect((await as(ctx.actor, (s) => googleDriveStatus(s))).configured).toBe(false);
    await expect(as(ctx.actor, async (s) => googleDriveConnectUrl(s))).rejects.toBeInstanceOf(DriveError);
  });

  it("URL de autorização: escopo restrito, acesso offline, redirecionamento da plataforma e estado assinado", async () => {
    env.GOOGLE_CLIENT_ID = "client-id-teste";
    env.GOOGLE_CLIENT_SECRET = "client-secret-teste";
    env.GOOGLE_DRIVE_SCOPE = undefined;
    const url = new URL(await as(ctx.actor, async (s) => googleDriveConnectUrl(s)));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id-teste");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${env.APP_URL.replace(/\/$/, "")}/api/integrations/google-drive/callback`,
    );
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(verifyDriveState(url.searchParams.get("state") ?? "", ctx.owner.id)?.org).toBe(ctx.org.slug);
  });

  it("concluir a conexão: tokens criptografados, conta confirmada; sem o escopo do Drive nada é salvo", async () => {
    mock.state.grantScope = "openid email";
    await expect(completeGoogleDriveConnection(ctx.actor, "code-ok")).rejects.toThrow(/permissão de acesso ao Drive/);
    expect(await withOrg(ctx.org.id, (tx) => tx.select().from(googleDriveConnections))).toEqual([]);

    mock.state.grantScope = "openid email https://www.googleapis.com/auth/drive.file";
    await expect(completeGoogleDriveConnection(ctx.actor, "code-ruim")).rejects.toThrow(/venceu ou foi revogada/);
    expect(await completeGoogleDriveConnection(ctx.actor, "code-ok")).toEqual({ email: "helena@gmail.test" });
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(googleDriveConnections));
    expect(row).toMatchObject({
      userId: ctx.owner.id,
      email: "helena@gmail.test",
      status: "connected",
      googleAccountId: "google-sub-1",
    });
    expect(row!.accessTokenEnc).not.toContain("tok-access-1");
    expect(decryptSecret(row!.accessTokenEnc)).toBe("tok-access-1");
    expect(decryptSecret(row!.refreshTokenEnc!)).toBe("tok-refresh-1");

    const status = await as(ctx.actor, (s) => googleDriveStatus(s));
    expect(status).toMatchObject({
      configured: true,
      connected: true,
      status: "connected",
      email: "helena@gmail.test",
      broadScope: false,
    });
    expect(JSON.stringify(status)).not.toContain("tok-");
    // Colega e outra organização: nada conectado para eles.
    expect((await as(colleague, (s) => googleDriveStatus(s))).connected).toBe(false);
    await expect(as(colleague, (s) => testGoogleDrive(s))).rejects.toThrow(/Conecte a sua conta/);
    expect(await withOrg(other.org.id, (tx) => tx.select().from(googleDriveConnections))).toEqual([]);
  });

  it("testar acesso: chamada real confirma a conta; token recusado marca autorização necessária", async () => {
    const ok = await as(ctx.actor, (s) => testGoogleDrive(s));
    expect(ok).toMatchObject({ ok: true, email: "helena@gmail.test" });
    expect(mock.calls.at(-1)?.url).toContain("/drive/v3/about");

    mock.state.accessTokens.clear();
    mock.state.refreshTokens.clear();
    const bad = await as(ctx.actor, (s) => testGoogleDrive(s));
    expect(bad.ok).toBe(false);
    expect((await as(ctx.actor, (s) => googleDriveStatus(s))).status).toBe("reauth_required");
    mock.state.accessTokens.add("tok-access-1");
    mock.state.refreshTokens.add("tok-refresh-1");
    expect((await as(ctx.actor, (s) => testGoogleDrive(s))).ok).toBe(true);
  });

  it("token vencido é renovado com o refresh token antes da chamada", async () => {
    await withSystem((tx) =>
      tx
        .update(googleDriveConnections)
        .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
        .where(eq(googleDriveConnections.userId, ctx.owner.id)),
    );
    expect((await as(ctx.actor, (s) => testGoogleDrive(s))).ok).toBe(true);
    const refresh = mock.calls.find(
      (c) => c.url.endsWith("/token") && (c.body ?? "").includes("grant_type=refresh_token"),
    );
    expect(refresh).toBeTruthy();
    const [row] = await withOrg(ctx.org.id, (tx) => tx.select().from(googleDriveConnections));
    expect(decryptSecret(row!.accessTokenEnc)).toBe("tok-access-2");
    expect(mock.calls.at(-1)?.auth).toBe("Bearer tok-access-2");
  });

  it("exportar: cria a raiz e as pastas cliente/projeto, envia o original e registra o elo com a versão", async () => {
    const png = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();
    const stored = await as(ctx.actor, (s) =>
      storeUpload(s, { buffer: png, originalName: "capa.png" }, { clientId, projectId, category: "deliverable" }),
    );
    const result = await as(ctx.actor, (s) => exportVersionToDrive(s, { versionId: stored.versionId }));
    expect(result.name).toBe("capa.png");
    expect(result.webViewLink).toContain("drive.google.com");
    const names = [...mock.state.files.values()].map((f) => `${f.mimeType === FOLDER ? "D" : "F"}:${f.name}`);
    expect(names).toEqual(["D:Aragonez Builder", "D:Cliente Nuvem", "D:Campanha Nuvem", "F:capa.png"]);
    const uploaded = [...mock.state.files.values()].find((f) => f.name === "capa.png")!;
    expect(uploaded.bytes.equals(png)).toBe(true);
    const projectFolder = [...mock.state.files.values()].find((f) => f.name === "Campanha Nuvem")!;
    expect(uploaded.parents).toEqual([projectFolder.id]);

    const links = await as(ctx.actor, (s) => driveLinksForFile(s, stored.fileId));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      direction: "export",
      driveFileId: uploaded.id,
      fileVersionId: stored.versionId,
      status: "ok",
    });
    // A raiz foi guardada e a colega não vê o elo (é da pessoa).
    expect((await as(ctx.actor, (s) => googleDriveStatus(s))).rootFolderId).toBe(
      [...mock.state.files.values()].find((f) => f.name === "Aragonez Builder")!.id,
    );
    expect(await as(colleague, (s) => driveLinksForFile(s, stored.fileId))).toEqual([]);
  });

  it("importar: baixa do Drive, valida tipo/tamanho e cria a cópia na plataforma com origem Google Drive", async () => {
    const jpg = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#aa5500" } })
      .jpeg()
      .toBuffer();
    const root = [...mock.state.files.values()].find((f) => f.name === "Aragonez Builder")!;
    const remote = mock.addFile({ name: "referencia.jpg", mimeType: "image/jpeg", parents: [root.id], bytes: jpg });
    const folder = mock.addFile({ name: "Subpasta", mimeType: FOLDER, parents: [root.id], bytes: Buffer.alloc(0) });
    const doc = mock.addFile({
      name: "Doc",
      mimeType: "application/vnd.google-apps.document",
      parents: [root.id],
      bytes: Buffer.alloc(0),
    });

    const imported = await as(ctx.actor, (s) => importFromDrive(s, { driveFileId: remote.id, clientId, projectId }));
    expect(imported.name).toBe("referencia.jpg");
    const [version] = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(fileVersions).where(eq(fileVersions.id, imported.versionId)),
    );
    expect(version).toMatchObject({ source: "drive", mimeType: "image/jpeg", sizeBytes: jpg.length });
    const rows = await withOrg(ctx.org.id, (tx) =>
      tx.select().from(googleDriveFiles).where(eq(googleDriveFiles.direction, "import")),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driveFileId: remote.id, fileId: imported.fileId, userId: ctx.owner.id });

    await expect(as(ctx.actor, (s) => importFromDrive(s, { driveFileId: folder.id }))).rejects.toThrow(/não uma pasta/);
    await expect(as(ctx.actor, (s) => importFromDrive(s, { driveFileId: doc.id }))).rejects.toThrow(
      /nativos do Google/,
    );
    await expect(as(ctx.actor, (s) => importFromDrive(s, { driveFileId: "nao-existe" }))).rejects.toThrow(
      /não encontrado/,
    );
  });

  it("navegar e buscar: pasta raiz por padrão, subpastas, busca por nome; criar pasta e pasta padrão", async () => {
    const root = await as(ctx.actor, (s) => listDriveFolder(s, {}));
    expect(root.folder?.name).toBe("Aragonez Builder");
    expect(root.entries.map((e) => e.name).sort()).toEqual(["Cliente Nuvem", "Doc", "Subpasta", "referencia.jpg"]);
    expect(root.entries.find((e) => e.name === "Subpasta")?.isFolder).toBe(true);

    const search = await as(ctx.actor, (s) => listDriveFolder(s, { query: "refer" }));
    expect(search.entries.map((e) => e.name)).toEqual(["referencia.jpg"]);

    const created = await as(ctx.actor, (s) => createDriveFolder(s, { name: "Entregas 2026" }));
    expect(created.isFolder).toBe(true);
    await as(ctx.actor, (s) =>
      updateGoogleDriveSettings(s, { defaultFolderId: created.id, organizeBy: "none", preferredDestination: "drive" }),
    );
    const status = await as(ctx.actor, (s) => googleDriveStatus(s));
    expect(status).toMatchObject({
      defaultFolderName: "Entregas 2026",
      organizeBy: "none",
      preferredDestination: "drive",
    });
    await expect(
      as(ctx.actor, (s) =>
        updateGoogleDriveSettings(s, { defaultFolderId: root.entries.find((e) => e.name === "referencia.jpg")!.id }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("falhas do Google viram erros claros: sem espaço, limite de chamadas, indisponível e rede", async () => {
    const run = () => as(ctx.actor, (s) => listDriveFolder(s, {})).catch((e: unknown) => e);
    mock.state.fail = { status: 403, reason: "storageQuotaExceeded" };
    expect(((await run()) as DriveError).kind).toBe("quota");
    mock.state.fail = { status: 429 };
    expect(((await run()) as DriveError).kind).toBe("rate_limit");
    mock.state.fail = { status: 503 };
    expect(((await run()) as DriveError).kind).toBe("unavailable");
    mock.state.fail = null;
    mock.state.network = true;
    expect(((await run()) as DriveError).kind).toBe("unavailable");
  });

  it("desconectar: revoga no Google, apaga a conexão e os elos; nada de token em lugar nenhum", async () => {
    await as(ctx.actor, (s) => disconnectGoogleDrive(s));
    expect(mock.state.revoked).toContain("tok-refresh-1");
    expect(await withOrg(ctx.org.id, (tx) => tx.select().from(googleDriveConnections))).toEqual([]);
    expect(await withOrg(ctx.org.id, (tx) => tx.select().from(googleDriveFiles))).toEqual([]);
    expect((await as(ctx.actor, (s) => googleDriveStatus(s))).connected).toBe(false);
  });
});

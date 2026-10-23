import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/authz/actor";
import { withSystem } from "@/server/db";
import { clients, projects, tasks } from "@/server/db/schema";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { importClientPackage, readPackageZip } from "@/server/services/client-package";
import { getPortalAdmin } from "@/server/services/client-portal";
import { getBrandProfile, getClient } from "@/server/services/clients";
import { listFiles } from "@/server/services/files";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Pacote de cliente: um zip com manifest.json cria cliente, marca, arquivos,
 * logotipo, projeto com demandas e portal publicado numa transação só.
 */

async function png(color = "#0b0b0b") {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: color } })
    .png()
    .toBuffer();
}

const manifest = (over: Record<string, unknown> = {}) => ({
  format: "aragonez-client-package",
  version: 1,
  client: { name: "GW Teste", industry: "Tráfego pago" },
  brand: {
    toneOfVoice: "Direto e didático.",
    keywords: ["tráfego pago", "performance"],
    colors: [
      { name: "Preto", hex: "#0b0b0b" },
      { name: "Verde-lima", hex: "#c3f23a" },
    ],
    fonts: [{ name: "Fraunces", usage: "Títulos" }],
  },
  files: [
    { path: "arquivos/logo.png", category: "brand_logo", tags: ["logo"], logo: true },
    { path: "arquivos/login.png", category: "brand_asset", tags: ["portal"] },
    { path: "arquivos/capa.png", category: "brand_asset", tags: ["portal"] },
  ],
  projects: [
    {
      name: "Conteúdo — 2 posts",
      objective: "Educar",
      tasks: [
        { title: "Post 1 — A", description: "Texto A" },
        { title: "Post 2 — B", description: "Texto B", priority: "high" },
      ],
    },
  ],
  portal: {
    settings: {
      displayName: "GW Teste",
      colors: { primary: "#c3f23a", secondary: "#1c1c1c" },
      welcomeTitle: "Estratégia que vira crescimento.",
      login: { layout: "card", title: "Portal GW" },
      banner: { title: "Olá", showLogo: false, focalX: 75 },
    },
    files: { logo: "arquivos/logo.png", loginBackground: "arquivos/login.png", banner: "arquivos/capa.png" },
    access: { loginEnabled: true },
    publish: true,
  },
  ...over,
});

async function pack(m: Record<string, unknown>, extra: Record<string, Uint8Array> = {}, prefix = "") {
  const files: Record<string, Uint8Array> = {
    [`${prefix}manifest.json`]: strToU8(JSON.stringify(m)),
    [`${prefix}arquivos/logo.png`]: new Uint8Array(await png("#0b0b0b")),
    [`${prefix}arquivos/login.png`]: new Uint8Array(await png("#1c1c1c")),
    [`${prefix}arquivos/capa.png`]: new Uint8Array(await png("#c3f23a")),
    ...extra,
  };
  return Buffer.from(zipSync(files));
}

let owner: Actor;
let orgId: string;
let orgSlug: string;

beforeAll(async () => {
  await resetDb();
  const created = await createOrgWithOwner("Agência Pacote");
  owner = created.actor;
  orgId = created.org.id;
  orgSlug = created.org.slug;
});

describe("importClientPackage", () => {
  it("cria cliente, marca, arquivos, logotipo, projeto, demandas e portal publicado", async () => {
    const zip = await pack(manifest());
    const result = await as(owner, (s) => importClientPackage(s, zip));
    expect(result).toMatchObject({ name: "GW Teste", files: 3, projects: 1, tasks: 2, portal: "published" });

    const { client } = await as(owner, (s) => getClient(s, result.clientId));
    expect(client.name).toBe("GW Teste");
    expect(client.industry).toBe("Tráfego pago");

    const brand = await as(owner, (s) => getBrandProfile(s, result.clientId));
    expect(brand?.toneOfVoice).toBe("Direto e didático.");
    expect(brand?.colors.map((c) => c.hex)).toEqual(["#0b0b0b", "#c3f23a"]);
    expect(brand?.fonts[0]?.name).toBe("Fraunces");
    expect(brand?.keywords).toEqual(["tráfego pago", "performance"]);

    const files = await as(owner, (s) => listFiles(s, { clientId: result.clientId, pageSize: 50 }));
    expect(files.rows.map((f) => f.name).sort()).toEqual(["capa.png", "login.png", "logo.png"]);
    const logo = files.rows.find((f) => f.name === "logo.png")!;
    expect(logo.category).toBe("brand_logo");
    expect(client.logoFileId).toBe(logo.id);

    const projectRows = await withSystem((tx) => tx.select().from(projects).where(eq(projects.clientId, result.clientId)));
    expect(projectRows).toHaveLength(1);
    expect(projectRows[0]!.name).toBe("Conteúdo — 2 posts");
    const taskRows = await withSystem((tx) => tx.select().from(tasks).where(eq(tasks.projectId, projectRows[0]!.id)));
    expect(taskRows.map((t) => t.title).sort()).toEqual(["Post 1 — A", "Post 2 — B"]);
    expect(taskRows.find((t) => t.title === "Post 2 — B")?.priority).toBe("high");

    const portal = await as(owner, (s) => getPortalAdmin(s, result.clientId));
    expect(portal.version).toBe(1);
    expect(portal.loginEnabled).toBe(true);
    expect(portal.published?.logoFileId).toBe(logo.id);
    expect(portal.published?.login.backgroundFileId).toBe(files.rows.find((f) => f.name === "login.png")!.id);
    expect(portal.published?.banner.imageFileId).toBe(files.rows.find((f) => f.name === "capa.png")!.id);
    expect(portal.published?.banner.title).toBe("Olá");
    expect(portal.published?.banner.showLogo).toBe(false);
    expect(portal.published?.colors.primary).toBe("#c3f23a");
  });

  it("aceita o pacote zipado como pasta e ignora lixo de sistema", async () => {
    const zip = await pack(
      manifest({ client: { name: "GW Pasta" }, portal: undefined }),
      { "__MACOSX/gw/._manifest.json": strToU8("lixo"), "gw/.DS_Store": strToU8("lixo") },
      "gw/",
    );
    const { root, entries } = readPackageZip(zip);
    expect(root).toBe("gw/");
    expect([...entries.keys()].some((k) => k.includes("__MACOSX") || k.endsWith(".DS_Store"))).toBe(false);
    const result = await as(owner, (s) => importClientPackage(s, zip));
    expect(result).toMatchObject({ name: "GW Pasta", files: 3, portal: "none" });
  });

  it("rejeita pacote sem manifesto, manifesto inválido e arquivo ausente, sem deixar cliente pela metade", async () => {
    const before = (await withSystem((tx) => tx.select({ id: clients.id }).from(clients))).length;

    const noManifest = Buffer.from(zipSync({ "arquivos/logo.png": new Uint8Array(await png()) }));
    await expect(as(owner, (s) => importClientPackage(s, noManifest))).rejects.toThrow(ValidationError);

    const notZip = Buffer.from("isto não é um zip");
    await expect(as(owner, (s) => importClientPackage(s, notZip))).rejects.toThrow(/zip válido/);

    const noName = await pack(manifest({ client: { industry: "x" } }));
    await expect(as(owner, (s) => importClientPackage(s, noName))).rejects.toThrow(/client\.name/);

    const missingFile = await pack(
      manifest({ files: [{ path: "arquivos/nao-existe.png", category: "brand_logo" }], portal: undefined }),
    );
    await expect(as(owner, (s) => importClientPackage(s, missingFile))).rejects.toThrow(/não dentro do pacote/);

    const badRef = await pack(
      manifest({ portal: { settings: {}, files: { logo: "arquivos/outro.png" } } }),
    );
    await expect(as(owner, (s) => importClientPackage(s, badRef))).rejects.toThrow(ValidationError);

    const after = (await withSystem((tx) => tx.select({ id: clients.id }).from(clients))).length;
    expect(after).toBe(before);
  });

  it("exige a permissão de criar clientes", async () => {
    let restricted: Actor | null = null;
    for (const key of ["finance", "collaborator", "designer"] as const) {
      const a = await addMember(orgSlug, orgId, key);
      if (!a.permissions.has("clients.write")) {
        restricted = a;
        break;
      }
    }
    expect(restricted).not.toBeNull();
    const zip = await pack(manifest({ client: { name: "Sem permissão" } }));
    await expect(as(restricted!, (s) => importClientPackage(s, zip))).rejects.toThrow(ForbiddenError);
  });
});

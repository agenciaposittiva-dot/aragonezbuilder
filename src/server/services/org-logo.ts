import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { z } from "zod";
import { formatBytes } from "@/lib/format";
import {
  ORG_LOGO_BACKGROUNDS,
  ORG_LOGO_MAX_PIXELS,
  ORG_LOGO_MAX_SIDE,
  ORG_LOGO_MIN_SIDE,
  ORG_LOGO_SIZE,
  orgLogoPath,
  type OrgLogoBackground,
  type OrgLogoCrop,
} from "@/lib/org-logo";
import { assertCan, assertInternal, inOrg, type Actor } from "@/server/authz";
import { withSystem } from "@/server/db";
import { memberships, organizations } from "@/server/db/schema";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import { recordActivity } from "./activity";

/*
 * Logo da agência. O arquivo enviado é validado pelo conteúdo (não pela
 * extensão), recortado no quadrado escolhido e gravado como PNG 512×512 no
 * armazenamento privado já configurado (local, S3, Vercel Blob ou banco). O
 * banco guarda só a referência (chave + hash). A imagem é entregue por
 * /api/org-logo/[orgId] apenas a quem tem vínculo ativo com a agência.
 */

const ACCEPTED_FORMATS = new Set(["png", "jpeg", "webp"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const orgLogoCropSchema = z.object({
  x: z.number().finite().min(-20).max(20),
  y: z.number().finite().min(-20).max(20),
  size: z.number().finite().gt(0).max(40),
});

export const orgLogoBackgroundSchema = z
  .enum(Object.keys(ORG_LOGO_BACKGROUNDS) as [OrgLogoBackground, ...OrgLogoBackground[]])
  .default("transparent");

export type OrgLogoUploadInput = {
  buffer: Buffer;
  crop?: OrgLogoCrop | null;
  background?: OrgLogoBackground;
};

function hexToRgba(hex: string | null) {
  if (!hex) return { r: 0, g: 0, b: 0, alpha: 0 };
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Valida a imagem original e produz o PNG final (512×512, sem metadados). */
export async function renderOrgLogo(input: OrgLogoUploadInput): Promise<Buffer> {
  const { buffer } = input;
  if (!buffer.length) throw new ValidationError("Nenhuma imagem enviada.");
  if (buffer.length > env.LOGO_MAX_BYTES) {
    throw new ValidationError(
      `A imagem tem ${formatBytes(buffer.length)}; o limite para a logo é ${formatBytes(env.LOGO_MAX_BYTES)}.`,
    );
  }

  let meta: Metadata;
  try {
    meta = await sharp(buffer, { limitInputPixels: ORG_LOGO_MAX_PIXELS }).metadata();
  } catch {
    throw new ValidationError("O arquivo não é uma imagem válida. Use PNG, JPG ou WebP.");
  }
  if (!ACCEPTED_FORMATS.has(meta.format)) {
    throw new ValidationError(
      `Formato não aceito (${String(meta.format).toUpperCase()}). Use PNG (recomendado), JPG ou WebP.`,
    );
  }
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new ValidationError("Não foi possível ler as dimensões da imagem.");
  if (Math.min(width, height) < ORG_LOGO_MIN_SIDE) {
    throw new ValidationError(
      `A imagem tem ${width}×${height} px; o mínimo é ${ORG_LOGO_MIN_SIDE}×${ORG_LOGO_MIN_SIDE} px.`,
    );
  }
  if (Math.max(width, height) > ORG_LOGO_MAX_SIDE || width * height > ORG_LOGO_MAX_PIXELS) {
    throw new ValidationError(
      `A imagem tem ${width}×${height} px; o máximo é ${ORG_LOGO_MAX_SIDE} px por lado. Reduza e tente de novo.`,
    );
  }

  // Sem recorte informado: a imagem inteira, centralizada no quadrado.
  const side = Math.max(width, height);
  const crop = input.crop
    ? orgLogoCropSchema.parse(input.crop)
    : { x: (width - side) / 2 / width, y: (height - side) / 2 / height, size: side / width };
  const left = crop.x * width;
  const top = crop.y * height;
  const size = crop.size * width;
  if (size < 16) throw new ValidationError("O zoom ficou alto demais. Reduza o zoom e confirme de novo.");

  // Parte do quadrado que de fato cobre a imagem.
  const ix0 = clamp(Math.round(left), 0, width);
  const iy0 = clamp(Math.round(top), 0, height);
  const ix1 = clamp(Math.round(left + size), 0, width);
  const iy1 = clamp(Math.round(top + size), 0, height);
  if (ix1 - ix0 < 1 || iy1 - iy0 < 1) {
    throw new ValidationError("O enquadramento ficou fora da imagem. Centralize a logo e confirme de novo.");
  }

  const k = ORG_LOGO_SIZE / size;
  const dx = clamp(Math.round((ix0 - left) * k), 0, ORG_LOGO_SIZE - 1);
  const dy = clamp(Math.round((iy0 - top) * k), 0, ORG_LOGO_SIZE - 1);
  const rw = clamp(Math.round((ix1 - ix0) * k), 1, ORG_LOGO_SIZE - dx);
  const rh = clamp(Math.round((iy1 - iy0) * k), 1, ORG_LOGO_SIZE - dy);

  try {
    const region = await sharp(buffer, { autoOrient: true, limitInputPixels: ORG_LOGO_MAX_PIXELS })
      .extract({ left: ix0, top: iy0, width: ix1 - ix0, height: iy1 - iy0 })
      .resize(rw, rh, { fit: "fill", kernel: "lanczos3" })
      .ensureAlpha()
      .png()
      .toBuffer();
    const background = hexToRgba(ORG_LOGO_BACKGROUNDS[input.background ?? "transparent"].color);
    return await sharp({
      create: { width: ORG_LOGO_SIZE, height: ORG_LOGO_SIZE, channels: 4, background },
    })
      .composite([{ input: region, left: dx, top: dy }])
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
  } catch {
    throw new ValidationError("Não foi possível processar a imagem. Tente outro arquivo PNG, JPG ou WebP.");
  }
}

export function logoStorageKey(orgId: string, hash: string) {
  return `${orgId}/branding/logo-${hash.slice(0, 32)}.png`;
}

async function deleteQuietly(key: string) {
  try {
    await getStorage().delete(key);
  } catch (err) {
    // A referência já foi trocada no banco; o objeto antigo fica órfão, sem efeito para o usuário.
    console.error("[org-logo] não foi possível apagar o arquivo antigo", key, err);
  }
}

/**
 * Grava a logo da organização do ator. Ordem segura: grava o arquivo novo,
 * troca a referência no banco e só depois apaga o arquivo anterior. Se o banco
 * falhar, o arquivo novo é descartado e a logo anterior continua valendo.
 */
export async function saveOrgLogo(actor: Actor, input: OrgLogoUploadInput) {
  assertInternal(actor);
  assertCan(actor, "org.manage");
  const png = await renderOrgLogo(input);
  const hash = createHash("sha256").update(png).digest("hex");

  const [current] = await inOrg(actor, (s) =>
    s.db
      .select({ key: organizations.logoKey, hash: organizations.logoHash })
      .from(organizations)
      .where(eq(organizations.id, actor.orgId)),
  );
  // Mesma imagem: nada a regravar.
  if (current?.key && current.hash === hash) {
    return { src: orgLogoPath(actor.orgId, hash), hash, changed: false };
  }

  const key = logoStorageKey(actor.orgId, hash);
  const storage = getStorage();
  await storage.put(key, png, { contentType: "image/png" });

  let previous: string | null;
  try {
    previous = await inOrg(actor, async (s) => {
      const [row] = await s.db
        .select({ key: organizations.logoKey })
        .from(organizations)
        .where(eq(organizations.id, actor.orgId))
        .for("update");
      await s.db
        .update(organizations)
        .set({ logoKey: key, logoHash: hash, logoUpdatedAt: new Date() })
        .where(eq(organizations.id, actor.orgId));
      await recordActivity(s, {
        action: row?.key ? "logo_replaced" : "logo_added",
        entityType: "organization",
        entityId: actor.orgId,
        summary: row?.key ? "Logo da agência substituída" : "Logo da agência enviada",
        event: false,
      });
      return row?.key ?? null;
    });
  } catch (err) {
    if (key !== current?.key) await deleteQuietly(key);
    throw err;
  }
  if (previous && previous !== key) await deleteQuietly(previous);
  return { src: orgLogoPath(actor.orgId, hash), hash, changed: true };
}

/** Remove a logo (enviada e link externo legado). Os demais dados da agência ficam intactos. */
export async function removeOrgLogo(actor: Actor) {
  assertInternal(actor);
  assertCan(actor, "org.manage");
  const previous = await inOrg(actor, async (s) => {
    const [row] = await s.db
      .select({ key: organizations.logoKey, url: organizations.logoUrl })
      .from(organizations)
      .where(eq(organizations.id, actor.orgId))
      .for("update");
    if (!row?.key && !row?.url) return null;
    await s.db
      .update(organizations)
      .set({ logoKey: null, logoHash: null, logoUrl: null, logoUpdatedAt: new Date() })
      .where(eq(organizations.id, actor.orgId));
    await recordActivity(s, {
      action: "logo_removed",
      entityType: "organization",
      entityId: actor.orgId,
      summary: "Logo da agência removida",
      event: false,
    });
    return row;
  });
  if (previous?.key) await deleteQuietly(previous.key);
  return { removed: !!previous };
}

/**
 * Lê a logo para entrega. Só devolve a imagem a quem tem vínculo ativo
 * (equipe ou cliente) com a organização; para os demais, nada (404).
 */
export async function readOrgLogo(orgId: string, userId: string) {
  if (!UUID_RE.test(orgId)) return null;
  const [row] = await withSystem((tx) =>
    tx
      .select({ key: organizations.logoKey, hash: organizations.logoHash })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(eq(memberships.organizationId, orgId), eq(memberships.userId, userId), eq(memberships.status, "active")),
      )
      .limit(1),
  );
  if (!row?.key || !row.hash) return null;
  try {
    return { body: await getStorage().get(row.key), hash: row.hash };
  } catch (err) {
    console.error("[org-logo] arquivo da logo indisponível", row.key, err);
    return null;
  }
}

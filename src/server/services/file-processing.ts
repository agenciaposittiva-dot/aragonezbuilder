import { eq } from "drizzle-orm";
import sharp from "sharp";
import { withOrg } from "@/server/db";
import { fileVersions } from "@/server/db/schema";
import { getStorage, thumbnailKey } from "@/server/storage";
import { isImage } from "./file-type";

const THUMB_MAX = 480;

/**
 * Processamento assíncrono de uma versão de arquivo (miniatura, dimensões).
 * Chamado pelo worker ao consumir o evento `file.version_uploaded`.
 * Idempotente: pode ser executado novamente sem efeitos colaterais.
 */
export async function processFileVersion(organizationId: string, fileVersionId: string): Promise<void> {
  const version = await withOrg(organizationId, async (tx) => {
    const [v] = await tx.select().from(fileVersions).where(eq(fileVersions.id, fileVersionId));
    return v ?? null;
  });
  if (!version || !isImage(version.mimeType)) return;

  const storage = getStorage();
  const original = await storage.get(version.storageKey);
  const image = sharp(original, { failOn: "none", limitInputPixels: 268_402_689 }).rotate();
  const meta = await image.metadata();
  const thumb = await image
    .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const key = thumbnailKey(organizationId, version.fileId, version.id);
  await storage.put(key, thumb, { contentType: "image/webp" });

  await withOrg(organizationId, (tx) =>
    tx
      .update(fileVersions)
      .set({
        thumbnailKey: key,
        width: version.width ?? meta.width ?? null,
        height: version.height ?? meta.height ?? null,
      })
      .where(eq(fileVersions.id, fileVersionId)),
  );
}

import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { storageObjects } from "@/server/db/schema";
import type { PutOptions, SignedUrlOptions, StorageDriver } from "./index";
import { signedAppUrl } from "./signing";

/**
 * Armazenamento no próprio Postgres. Indicado para começar sem contratar um
 * bucket (ex.: Vercel, onde o disco não é persistente); para volumes maiores,
 * prefira S3. Downloads passam por /api/files/download com link assinado.
 */
export class DatabaseStorage implements StorageDriver {
  readonly name = "database" as const;

  async put(key: string, body: Buffer, opts: PutOptions) {
    await db
      .insert(storageObjects)
      .values({ key, data: body, contentType: opts.contentType, sizeBytes: body.length })
      .onConflictDoUpdate({
        target: storageObjects.key,
        set: { data: body, contentType: opts.contentType, sizeBytes: body.length, createdAt: sql`now()` },
      });
  }

  async get(key: string) {
    const [row] = await db
      .select({ data: storageObjects.data })
      .from(storageObjects)
      .where(eq(storageObjects.key, key));
    if (!row) throw new Error("Objeto não encontrado");
    return row.data;
  }

  async stream(key: string) {
    const data = await this.get(key);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(data));
        controller.close();
      },
    });
    return { body, size: data.length };
  }

  async delete(key: string) {
    await db.delete(storageObjects).where(eq(storageObjects.key, key));
  }

  async exists(key: string) {
    const [row] = await db.select({ key: storageObjects.key }).from(storageObjects).where(eq(storageObjects.key, key));
    return !!row;
  }

  async signedUrl(key: string, opts: SignedUrlOptions) {
    return signedAppUrl(key, opts);
  }
}

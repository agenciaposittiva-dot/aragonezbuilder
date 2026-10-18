import "server-only";
import { env } from "@/server/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

export type PutOptions = { contentType: string };

export type SignedUrlOptions = {
  /** Nome sugerido no download. */
  name: string;
  contentType: string;
  disposition: "inline" | "attachment";
  /** Validade em segundos (padrão: 5 minutos). */
  expiresIn?: number;
};

/** Armazenamento privado de objetos. Nenhum arquivo fica publicamente acessível. */
export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, body: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, opts: SignedUrlOptions): Promise<string>;
}

let instance: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (instance) return instance;
  instance = env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(env.STORAGE_LOCAL_DIR);
  return instance;
}

/** Nome de arquivo seguro para compor chaves (sem barras, sem controle). */
export function safeFileName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return base || "arquivo";
}

export function versionKey(orgId: string, fileId: string, versionId: string, name: string) {
  return `${orgId}/${fileId}/${versionId}-${safeFileName(name)}`;
}

export function thumbnailKey(orgId: string, fileId: string, versionId: string) {
  return `${orgId}/${fileId}/thumbs/${versionId}.webp`;
}

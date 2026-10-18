import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import { env } from "@/server/env";
import type { PutOptions, SignedUrlOptions, StorageDriver } from "./index";
import { signedAppUrl } from "./signing";

/** Pasta própria dentro do store: o mesmo Blob pode ser compartilhado com outros projetos. */
const PREFIX = "aragonez/";

/** Credenciais resolvidas por src/server/env.ts (aceita nomes com prefixo da integração). */
const auth = () => ({ token: env.BLOB_READ_WRITE_TOKEN, storeId: env.BLOB_STORE_ID });

/**
 * Vercel Blob em modo privado. A autenticação é feita pelo SDK oficial:
 * BLOB_READ_WRITE_TOKEN ou, na Vercel, OIDC com BLOB_STORE_ID. Nenhum arquivo
 * fica público: downloads passam por /api/files/download com link assinado,
 * depois da verificação de acesso feita pelos serviços de arquivos.
 */
export class BlobStorage implements StorageDriver {
  readonly name = "blob" as const;

  async put(key: string, body: Buffer, opts: PutOptions) {
    await put(PREFIX + key, body, {
      ...auth(),
      access: "private",
      contentType: opts.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async get(key: string) {
    const { body } = await this.stream(key);
    return Buffer.from(await new Response(body).arrayBuffer());
  }

  async stream(key: string) {
    const res = await get(PREFIX + key, { ...auth(), access: "private", useCache: false });
    if (!res || res.statusCode !== 200) throw new Error("Objeto não encontrado");
    return { body: res.stream, size: res.blob.size };
  }

  async delete(key: string) {
    await del(PREFIX + key, auth());
  }

  async exists(key: string) {
    try {
      await head(PREFIX + key, auth());
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }

  async signedUrl(key: string, opts: SignedUrlOptions) {
    return signedAppUrl(key, opts);
  }
}

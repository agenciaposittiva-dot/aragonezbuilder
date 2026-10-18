import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { PutOptions, SignedUrlOptions, StorageDriver } from "./index";
import { signedAppUrl } from "./signing";

/** Pasta própria dentro do store: o mesmo Blob pode ser compartilhado com outros projetos. */
const PREFIX = "aragonez/";

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
    const res = await get(PREFIX + key, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200) throw new Error("Objeto não encontrado");
    return { body: res.stream, size: res.blob.size };
  }

  async delete(key: string) {
    await del(PREFIX + key);
  }

  async exists(key: string) {
    try {
      await head(PREFIX + key);
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

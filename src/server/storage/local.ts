import { createReadStream } from "node:fs";
import { mkdir, rm, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { SignedUrlOptions, StorageDriver } from "./index";
import { signDownload } from "./signing";

/**
 * Armazenamento em disco (desenvolvimento ou servidor único com volume persistente).
 * Downloads passam por /api/files/download com assinatura HMAC e validade curta.
 */
export class LocalStorage implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  /** Resolve a chave dentro da raiz, recusando qualquer tentativa de sair dela. */
  resolve(key: string): string {
    if (!key || key.includes("\0") || path.isAbsolute(key) || key.split("/").some((p) => p === ".." || p === "")) {
      throw new Error("Chave de armazenamento inválida");
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Chave de armazenamento inválida");
    return full;
  }

  async put(key: string, body: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async stream(key: string) {
    const full = this.resolve(key);
    const info = await stat(full);
    const body = Readable.toWeb(createReadStream(full)) as unknown as ReadableStream<Uint8Array>;
    return { body, size: info.size };
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async signedUrl(key: string, opts: SignedUrlOptions) {
    const exp = Math.floor(Date.now() / 1000) + (opts.expiresIn ?? 300);
    const claims = { key, exp, name: opts.name, disposition: opts.disposition, type: opts.contentType };
    const qs = new URLSearchParams({
      key,
      exp: String(exp),
      name: opts.name,
      disposition: opts.disposition,
      type: opts.contentType,
      sig: signDownload(claims),
    });
    // URL relativa: funciona atrás de proxies e em qualquer domínio.
    return `/api/files/download?${qs.toString()}`;
  }
}

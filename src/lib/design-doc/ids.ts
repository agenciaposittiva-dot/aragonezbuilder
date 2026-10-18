const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Identificador curto e aleatório para páginas, objetos e componentes. */
export function newId(size = 10): string {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** Gerador determinístico (testes e migração reprodutível). */
export function sequentialIds(prefix = "id") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

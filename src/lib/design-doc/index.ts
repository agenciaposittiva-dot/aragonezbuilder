/*
 * Documento editável do Estúdio — modelo, leitura (com migração do formato
 * antigo), operações e utilidades. Veja docs/EDITOR-PLAN.md.
 */
export * from "./schema";
export * from "./geometry";
export * from "./build";
export * from "./presets";
export * from "./read";
export * from "./query";
export * from "./ops";
export * from "./generator";
export { convertLegacyDocument, isLegacyDocument, normalizeSrc } from "./legacy";
export { newId, sequentialIds } from "./ids";

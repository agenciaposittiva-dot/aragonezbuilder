import { FORMAT_PRESETS } from "./design-doc/presets";

/** Compatibilidade: lista simples de formatos (a completa, com grupos e carrossel, está em design-doc/presets). */
export const DESIGN_PRESETS = FORMAT_PRESETS.map(({ key, label, width, height }) => ({ key, label, width, height }));

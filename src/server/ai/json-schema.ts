/*
 * Saída estruturada entre provedores. Cada API aplica o esquema JSON de um
 * jeito (Anthropic: output_config.format; OpenAI: response_format json_schema;
 * Gemini: responseJsonSchema). Quando o provedor ou o modelo não aceita o
 * esquema, ele vai por escrito nas instruções — sem isso o modelo inventa os
 * nomes dos campos e a resposta é recusada pela validação.
 */

/** Instrução de formato anexada ao system quando o esquema não pode ser imposto pela API. */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    "Formato obrigatório da resposta: um único objeto JSON válido, sem texto antes ou depois e sem bloco de código.",
    "Use exatamente os nomes de campos deste esquema JSON, inclua todos os campos obrigatórios e não envolva o objeto em outra chave:",
    JSON.stringify(schema),
  ].join("\n");
}

export function withSchemaInstruction(system: string, schema: Record<string, unknown>): string {
  return `${system}\n\n${schemaInstruction(schema)}`;
}

/** Palavras-chave aceitas no modo estrito da OpenAI (Structured Outputs). */
const STRICT_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "description",
  "$defs",
  "$ref",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minItems",
  "maxItems",
]);

function strictNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const n = node as Record<string, unknown>;
  if (Object.keys(n).some((k) => !STRICT_KEYWORDS.has(k))) return false;
  const types = Array.isArray(n.type) ? n.type : [n.type];
  if (types.includes("object") || n.properties) {
    const props = (n.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(n.required) ? n.required : [];
    if (n.additionalProperties !== false) return false;
    if (Object.keys(props).some((k) => !required.includes(k))) return false;
    if (!Object.values(props).every(strictNode)) return false;
  }
  if (n.items !== undefined && !strictNode(n.items)) return false;
  if (n.anyOf !== undefined && !(Array.isArray(n.anyOf) && n.anyOf.every(strictNode))) return false;
  if (n.$defs !== undefined && !Object.values(n.$defs as Record<string, unknown>).every(strictNode)) return false;
  return true;
}

/**
 * O esquema cabe no modo estrito da OpenAI? (raiz objeto, todo objeto com
 * additionalProperties: false e todos os campos obrigatórios, só palavras-chave
 * suportadas). Fora disso, o esquema vai como orientação (strict: false).
 */
export function isStrictCompatible(schema: Record<string, unknown>): boolean {
  return schema.type === "object" && strictNode(schema);
}

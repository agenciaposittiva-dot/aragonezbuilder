import sharp from "sharp";
import { vi } from "vitest";

/*
 * Simulação das APIs oficiais dos provedores (via fetch global), com o mesmo
 * formato de resposta documentado nos SDKs. Nenhuma chamada sai da máquina.
 */

export type MockCall = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | null;
  /** Corpo multipart (ex.: edição de imagem com a original anexada). */
  form: FormData | null;
};

/** PNG 1×1 válido (a Central de Arquivos identifica o tipo pelos bytes). */
export const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const support = (supported: boolean) => ({ supported });

export function anthropicModel(id: string, line: string, opts: { structured?: boolean; created?: string } = {}) {
  return {
    type: "model",
    id,
    display_name: id.replace(/-/g, " "),
    created_at: opts.created ?? "2026-05-01T00:00:00Z",
    deprecated_at: null,
    retires_at: null,
    lifecycle: "active",
    line,
    max_input_tokens: 400_000,
    max_tokens: 64_000,
    capabilities: {
      batch: support(true),
      citations: support(true),
      code_execution: support(true),
      context_management: { supported: true },
      effort: { supported: true },
      image_input: support(true),
      pdf_input: support(true),
      server_tools: { supported: true },
      structured_outputs: support(opts.structured ?? true),
      thinking: { supported: true },
    },
  };
}

export type AiMockState = {
  /** Chaves aceitas por provedor (as demais recebem 401). */
  valid: { anthropic: Set<string>; openai: Set<string>; gemini: Set<string> };
  anthropicModels: ReturnType<typeof anthropicModel>[];
  openaiModels: string[];
  geminiModels: { name: string; displayName?: string; supportedGenerationMethods: string[] }[];
  /** Texto devolvido pelos modelos de texto. */
  reply: string;
  /** Status HTTP forçado para as chamadas de geração (texto e imagem). */
  failStatus: number | null;
  /** Imagens geradas: PNG 1×1 ("tiny") ou no tamanho pedido em `size` ("request"), uma por `n`. */
  imageSize: "tiny" | "request";
};

/** PNG sólido no tamanho pedido pela Images API (ex.: "1024x1536"). */
async function requestedPng(size: string) {
  const m = /^(\d+)x(\d+)$/.exec(size);
  const width = m ? Number(m[1]) : 1024;
  const height = m ? Number(m[2]) : 1024;
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 210, g: 140, b: 60 } } })
    .png()
    .toBuffer();
  return buf.toString("base64");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sse(events: Record<string, unknown>[]) {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function anthropicStream(model: string, text: string) {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg_teste",
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 120, output_tokens: 1 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 80 },
    },
    { type: "message_stop" },
  ]);
}

export function installAiMock() {
  const calls: MockCall[] = [];
  const state: AiMockState = {
    valid: { anthropic: new Set(), openai: new Set(), gemini: new Set() },
    anthropicModels: [
      anthropicModel("claude-sonnet-5-5", "sonnet", { created: "2026-05-01T00:00:00Z" }),
      anthropicModel("claude-haiku-5-5", "haiku", { created: "2026-04-01T00:00:00Z" }),
    ],
    openaiModels: ["gpt-5.1", "gpt-5.1-mini", "gpt-image-1", "text-embedding-3-small", "whisper-1"],
    geminiModels: [
      {
        name: "models/gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        supportedGenerationMethods: ["generateContent"],
      },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    ],
    reply: "Legenda de teste gerada pelo modelo.",
    failStatus: null,
    imageSize: "tiny",
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    const form = init?.body instanceof FormData ? init.body : null;
    calls.push({ url, method, headers, body, form });
    const u = new URL(url);

    if (u.host === "api.anthropic.com") {
      if (!state.valid.anthropic.has(headers.get("x-api-key") ?? "")) {
        return json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401);
      }
      if (u.pathname === "/v1/models") {
        const data = state.anthropicModels;
        return json({ data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
      }
      if (u.pathname === "/v1/messages") {
        if (state.failStatus) {
          return json({ type: "error", error: { type: "api_error", message: "falha simulada" } }, state.failStatus);
        }
        return anthropicStream(String(body?.model), state.reply);
      }
    }

    if (u.host === "api.openai.com") {
      const key = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
      if (!state.valid.openai.has(key))
        return json({ error: { message: "Incorrect API key", code: "invalid_api_key" } }, 401);
      if (u.pathname === "/v1/models") {
        return json({
          object: "list",
          data: state.openaiModels.map((id) => ({ id, object: "model", created: 1_760_000_000, owned_by: "openai" })),
        });
      }
      if (state.failStatus)
        return json({ error: { message: "falha simulada", code: "server_error" } }, state.failStatus);
      if (u.pathname === "/v1/chat/completions") {
        return json({
          id: "chatcmpl-teste",
          model: String(body?.model),
          choices: [{ index: 0, message: { role: "assistant", content: state.reply }, finish_reason: "stop" }],
          usage: { prompt_tokens: 90, completion_tokens: 40 },
        });
      }
      if (u.pathname === "/v1/images/edits") {
        const image = form?.get("image");
        if (!(image instanceof Blob) || !image.size) {
          return json({ error: { message: "image is required", code: "invalid_request_error" } }, 400);
        }
        return json({
          created: 1_760_000_000,
          data: [{ b64_json: TINY_PNG }],
          usage: { input_tokens: 40, output_tokens: 272 },
        });
      }
      if (u.pathname === "/v1/images/generations") {
        const n = Math.max(1, Math.min(10, Number(body?.n ?? 1) || 1));
        const b64 = state.imageSize === "request" ? await requestedPng(String(body?.size ?? "1024x1024")) : TINY_PNG;
        return json({
          created: 1_760_000_000,
          data: Array.from({ length: n }, () => ({ b64_json: b64 })),
          usage: { input_tokens: 15, output_tokens: 272 * n },
        });
      }
    }

    if (u.host === "generativelanguage.googleapis.com") {
      if (!state.valid.gemini.has(headers.get("x-goog-api-key") ?? "")) {
        return json({ error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" } }, 400);
      }
      if (u.pathname === "/v1beta/models") return json({ models: state.geminiModels });
    }

    throw new Error(`Chamada de rede inesperada no teste: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    state,
    /** Chamadas de geração (não de listagem de modelos). */
    generationCalls: () => calls.filter((c) => c.method === "POST"),
    reset() {
      calls.length = 0;
      state.failStatus = null;
      state.imageSize = "tiny";
    },
  };
}

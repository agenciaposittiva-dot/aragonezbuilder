import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_JSON_SCHEMA } from "@/lib/carousel-gen/plan";
import { isStrictCompatible } from "@/server/ai/json-schema";
import { createAnthropicProvider } from "@/server/ai/providers/anthropic";
import { createGeminiProvider } from "@/server/ai/providers/gemini";
import { createOpenAiProvider } from "@/server/ai/providers/openai";
import { AiProviderError } from "@/server/ai/types";
import { installAiMock } from "./ai-mocks";

/*
 * Saída estruturada em todos os provedores: o esquema JSON chega ao modelo
 * (imposto pela API quando possível, por escrito quando não), para o modelo
 * não inventar nomes de campos — o erro "O modelo devolveu campos incompletos"
 * do gerador de carrosséis com o ChatGPT.
 */

type Sent = { url: string; body: Record<string, unknown> };

function stubFetch(handler: (sent: Sent, n: number) => Response) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const s = { url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
      sent.push(s);
      return handler(s, sent.length);
    }),
  );
  return sent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const openAiReply = (content: string | null, extra: Record<string, unknown> = {}) =>
  json({
    model: "gpt-6.1-sol",
    choices: [{ message: { content, ...extra }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });

const LOOSE_SCHEMA = { type: "object", properties: { title: { type: "string", maxLength: 80 } }, required: ["title"] };
const req = (jsonSchema?: Record<string, unknown>) => ({
  model: "gpt-6.1-sol",
  system: "Você é um assistente.",
  prompt: "Tema: Claude x ChatGPT",
  maxTokens: 500,
  jsonSchema,
});
type Message = { role: string; content: string };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("esquema estrito", () => {
  it("o plano do carrossel cabe no modo estrito; esquemas soltos não", () => {
    expect(isStrictCompatible(PLAN_JSON_SCHEMA)).toBe(true);
    expect(isStrictCompatible(LOOSE_SCHEMA)).toBe(false);
    expect(
      isStrictCompatible({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      }),
    ).toBe(false);
  });
});

describe("OpenAI", () => {
  it("envia o esquema em response_format (modo estrito) sem repetir no texto", async () => {
    const sent = stubFetch(() => openAiReply('{"title":"ok"}'));
    const r = await createOpenAiProvider("k").generate(req(PLAN_JSON_SCHEMA));
    expect(r.text).toBe('{"title":"ok"}');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "resposta", schema: PLAN_JSON_SCHEMA, strict: true },
    });
    expect((sent[0]!.body.messages as Message[])[0]!.content).toBe("Você é um assistente.");
  });

  it("esquema fora do modo estrito: vai como orientação e também por escrito", async () => {
    const sent = stubFetch(() => openAiReply('{"title":"ok"}'));
    await createOpenAiProvider("k").generate(req(LOOSE_SCHEMA));
    const format = sent[0]!.body.response_format as { json_schema: { strict: boolean } };
    expect(format.json_schema.strict).toBe(false);
    const system = (sent[0]!.body.messages as Message[])[0]!.content;
    expect(system).toContain("Use exatamente os nomes de campos deste esquema JSON");
    expect(system).toContain(JSON.stringify(LOOSE_SCHEMA));
  });

  it("modelo sem json_schema: repete em modo JSON com o esquema nas instruções", async () => {
    const sent = stubFetch((_s, n) =>
      n === 1
        ? json({ error: { message: "response_format json_schema is not supported", code: "invalid_request" } }, 400)
        : openAiReply('{"title":"ok"}'),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await createOpenAiProvider("k").generate(req(PLAN_JSON_SCHEMA));
    warn.mockRestore();
    expect(r.text).toBe('{"title":"ok"}');
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.response_format).toEqual({ type: "json_object" });
    expect((sent[1]!.body.messages as Message[])[0]!.content).toContain(JSON.stringify(PLAN_JSON_SCHEMA));
  });

  it("sem esquema, nada muda; recusa do modelo vira erro claro", async () => {
    const sent = stubFetch(() => openAiReply("Texto livre"));
    await createOpenAiProvider("k").generate(req());
    expect(sent[0]!.body.response_format).toBeUndefined();

    stubFetch(() => openAiReply(null, { refusal: "I can't help with that." }));
    const err = await createOpenAiProvider("k")
      .generate(req(PLAN_JSON_SCHEMA))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect((err as AiProviderError).kind).toBe("refusal");
  });
});

describe("Gemini", () => {
  const reply = () =>
    json({
      modelVersion: "gemini-3.5-flash",
      candidates: [{ content: { parts: [{ text: '{"title":"ok"}' }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

  it("envia o esquema em responseJsonSchema; se o modelo recusar, repete com o esquema por escrito", async () => {
    let sent = stubFetch(() => reply());
    await createGeminiProvider("k").generate({ ...req(PLAN_JSON_SCHEMA), model: "gemini-3.5-flash" });
    expect(sent[0]!.body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: PLAN_JSON_SCHEMA,
    });

    sent = stubFetch((_s, n) => (n === 1 ? json({ error: { code: 400, message: "Unknown name" } }, 400) : reply()));
    const r = await createGeminiProvider("k").generate({ ...req(PLAN_JSON_SCHEMA), model: "gemini-3.5-flash" });
    expect(r.text).toBe('{"title":"ok"}');
    expect(sent).toHaveLength(2);
    const config = sent[1]!.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toBeUndefined();
    const system = sent[1]!.body.systemInstruction as { parts: { text: string }[] };
    expect(system.parts[0]!.text).toContain(JSON.stringify(PLAN_JSON_SCHEMA));
  });
});

describe("Anthropic", () => {
  it("modelo sem saída estruturada confirmada recebe o esquema por escrito", async () => {
    const mock = installAiMock();
    mock.state.valid.anthropic.add("k");
    mock.state.reply = '{"title":"ok"}';
    const provider = createAnthropicProvider("k");

    await provider.generate({ ...req(PLAN_JSON_SCHEMA), model: "claude-antigo", modelCaps: { structured: "no" } });
    let body = mock.generationCalls().at(-1)!.body!;
    expect(String(body.system)).toContain(JSON.stringify(PLAN_JSON_SCHEMA));
    expect(body.output_config).toBeUndefined();

    await provider.generate({ ...req(PLAN_JSON_SCHEMA), model: "claude-sonnet-5-5" });
    body = mock.generationCalls().at(-1)!.body!;
    expect(body.system).toBe("Você é um assistente.");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema", schema: PLAN_JSON_SCHEMA } });
  });
});

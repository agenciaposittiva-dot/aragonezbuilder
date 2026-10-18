import { z } from "zod";
import type { Scope } from "@/server/authz";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { prepareGeneration } from "./ai";
import { aiSelectionInput } from "./ai-models";
import { assertChat, conversationTranscript, searchTranscript } from "./chat";
import { getSettings } from "./organizations";

export const CHAT_AI_ACTIONS = ["summary", "catch_up", "decisions", "tasks", "reply", "rewrite", "ask"] as const;

export const chatAiInput = z.object({
  conversationId: z.uuid(),
  action: z.enum(CHAT_AI_ACTIONS),
  draft: z.string().max(8000).optional(),
  question: z.string().max(1000).optional(),
  /** "conversation" = só a conversa aberta; "all" = todas as conversas que a pessoa pode ler. */
  scope: z.enum(["conversation", "all"]).default("conversation"),
  selection: aiSelectionInput.optional(),
  confirmCost: z.boolean().optional(),
});

/**
 * Monta o pedido de IA do chat. O contexto vem do servidor (só mensagens que
 * a pessoa pode ler) e só segue para o provedor se a organização autorizou a
 * leitura de conversas. Reescrever usa apenas o texto digitado.
 * `stored` é o que vai para o histórico de gerações: nunca o texto da conversa.
 */
export async function prepareChatAi(s: Scope, raw: z.input<typeof chatAiInput>) {
  assertChat(s);
  const data = chatAiInput.parse(raw);
  const settings = (await getSettings(s)).ai;
  const needsContext = data.action !== "rewrite";
  if (needsContext && !settings.allowChatContext) {
    throw new ForbiddenError(
      "A organização ainda não autorizou a IA a ler conversas do chat. Um administrador pode ativar em Configurações › Inteligência artificial.",
    );
  }
  const input: Record<string, string> = {};
  if (data.action === "rewrite") {
    if (!data.draft?.trim()) throw new ValidationError("Escreva a mensagem que deseja reescrever.");
    input.draft = data.draft;
  } else {
    const conv = await conversationTranscript(s, data.conversationId, {
      unreadOnly: data.action === "catch_up",
      maxChars: data.action === "ask" && data.scope === "all" ? 7000 : data.action === "reply" ? 8000 : 18_000,
    });
    let transcript = conv.transcript;
    if (data.action === "ask") {
      if (!data.question?.trim()) throw new ValidationError("Escreva a pergunta.");
      input.question = data.question;
      if (data.scope === "all") {
        const related = await searchTranscript(s, data.question);
        transcript = [
          related && `Mensagens relacionadas em outras conversas:\n${related}`,
          transcript && `Conversa aberta:\n${transcript}`,
        ]
          .filter(Boolean)
          .join("\n\n");
      }
    }
    if (!transcript.trim()) {
      throw new ValidationError(
        data.action === "catch_up" ? "Nada novo desde a sua última visita." : "Ainda não há mensagens para analisar.",
      );
    }
    input.transcript = transcript;
    if (data.action === "reply" && data.draft?.trim()) input.draft = data.draft;
  }
  const prepared = await prepareGeneration(s, {
    operation: `chat_${data.action}`,
    input,
    module: "chat",
    selection: data.selection,
    confirmCost: data.confirmCost,
  });
  const stored: Record<string, string> = { text: prepared.label };
  if (input.question) stored.question = input.question;
  if (input.draft) stored.draft = input.draft;
  return { prepared, stored };
}

import { NextResponse } from "next/server";
import { chatHandler, readJson, str } from "@/server/chat-http";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { removeConversationPhoto, saveConversationPhoto } from "@/server/services/chat-photo";
import { orgLogoCropSchema } from "@/server/services/org-logo";

export const runtime = "nodejs";

/**
 * Envia ou troca a foto de um grupo/canal (multipart: org, conversationId,
 * file, crop). Responde só depois de gravar o arquivo e a conversa.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.CHAT_PHOTO_MAX_BYTES + 256 * 1024) {
    return NextResponse.json({ ok: false, error: "Imagem grande demais para a foto do grupo." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Envio inválido ou interrompido." }, { status: 400 });
  }
  const org = form.get("org");
  const conversationId = form.get("conversationId");
  const file = form.get("file");
  const rawCrop = form.get("crop");
  return chatHandler(
    req,
    typeof org === "string" ? org : null,
    async (s) => {
      if (!file || typeof file === "string") throw new ValidationError("Nenhuma imagem enviada.");
      let crop = null;
      if (typeof rawCrop === "string" && rawCrop) {
        let json: unknown;
        try {
          json = JSON.parse(rawCrop);
        } catch {
          throw new ValidationError("Enquadramento inválido.");
        }
        const parsed = orgLogoCropSchema.safeParse(json);
        if (!parsed.success) throw new ValidationError("Enquadramento inválido.");
        crop = parsed.data;
      }
      return saveConversationPhoto(s, typeof conversationId === "string" ? conversationId : "", {
        buffer: Buffer.from(await file.arrayBuffer()),
        crop,
      });
    },
    { mutating: true },
  );
}

/** Remove a foto (volta ao ícone do grupo). Corpo: { org, conversationId }. */
export async function DELETE(req: Request) {
  const body = await readJson(req);
  return chatHandler(req, str(body.org), (s) => removeConversationPhoto(s, str(body.conversationId)), {
    mutating: true,
  });
}

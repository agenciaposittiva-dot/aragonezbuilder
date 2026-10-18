import { NextResponse } from "next/server";
import { chatHandler } from "@/server/chat-http";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { uploadChatAttachment } from "@/server/services/chat-attachments";

export const runtime = "nodejs";

/** Envia um anexo (multipart: org, conversationId, file). Validado no servidor. */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.UPLOAD_MAX_BYTES * 1.05 + 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Arquivo grande demais." }, { status: 413 });
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
  return chatHandler(
    req,
    typeof org === "string" ? org : null,
    async (s) => {
      if (!file || typeof file === "string") throw new ValidationError("Nenhum arquivo enviado.");
      const buffer = Buffer.from(await file.arrayBuffer());
      return uploadChatAttachment(s, typeof conversationId === "string" ? conversationId : "", {
        buffer,
        originalName: file.name,
      });
    },
    { mutating: true },
  );
}

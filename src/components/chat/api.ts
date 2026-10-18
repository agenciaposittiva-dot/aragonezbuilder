"use client";

import type { ChatMessageDTO, ConversationSummary, ConversationView } from "@/server/services/chat";

export type { ChatMessageDTO, ConversationSummary, ConversationView };

export type Presence = { userId: string; availability: string; active: boolean; lastSeenAt: string | null };

export type SyncResponse = {
  lv: string;
  conversations: ConversationSummary[] | null;
  unread: number;
  active: { conversation: ConversationView; messages: ChatMessageDTO[]; hasMore: boolean | null } | null;
  gone: boolean;
  presence: Presence[];
};

export class ChatApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
  /** Falha de rede/servidor (vale tentar de novo) x recusa definitiva (permissão, validação). */
  get retryable() {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | ({ ok: true; data: T } & Record<string, unknown>)
    | ({ ok: false; error?: string; code?: string } & Record<string, unknown>)
    | null;
  if (!res.ok || !body || body.ok !== true) {
    const err = body && body.ok === false ? body : null;
    throw new ChatApiError(err?.error ?? "Não foi possível falar com o servidor.", res.status, err?.code, err ?? {});
  }
  return body.data;
}

export async function chatGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(`${path}?${q}`, { signal, cache: "no-store" });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ChatApiError("Sem conexão com o servidor.", 0);
  }
  return handle<T>(res);
}

export async function chatSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ChatApiError("Sem conexão com o servidor.", 0);
  }
  return handle<T>(res);
}

export type UploadedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

/** Envio com progresso (XHR); `abort` cancela. Erros voltam como ChatApiError. */
export function uploadAttachment(
  org: string,
  conversationId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadedAttachment>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadedAttachment>((resolve, reject) => {
    const form = new FormData();
    form.set("org", org);
    form.set("conversationId", conversationId);
    form.set("file", file);
    xhr.open("POST", "/api/chat/attachments");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      type UploadBody = { ok?: boolean; data?: UploadedAttachment; error?: string; code?: string };
      let body: UploadBody | null;
      try {
        body = JSON.parse(xhr.responseText) as UploadBody;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.ok && body.data) resolve(body.data);
      else reject(new ChatApiError(body?.error ?? "Não foi possível enviar o arquivo.", xhr.status, body?.code));
    };
    xhr.onerror = () => reject(new ChatApiError("O envio foi interrompido. Verifique a conexão e tente de novo.", 0));
    xhr.onabort = () => reject(new ChatApiError("Envio cancelado.", 0, "aborted"));
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function attachmentUrl(org: string, id: string, download = false) {
  return `/api/chat/attachments/${id}?org=${encodeURIComponent(org)}${download ? "&download=1" : ""}`;
}

/** Id do navegador para a mensagem (o servidor usa para não duplicar reenvios). */
export function newClientId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
}

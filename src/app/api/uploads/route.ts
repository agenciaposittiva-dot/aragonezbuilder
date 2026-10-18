import { NextResponse } from "next/server";
import { inOrg } from "@/server/authz";
import { jsonError, routeActor } from "@/server/auth/route-actor";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { storeUpload } from "@/server/services/files";

export const runtime = "nodejs";

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Recebe um ou mais arquivos (multipart). Cada arquivo é validado no servidor
 * (tamanho, tipo real pelos bytes) e gravado no armazenamento privado.
 */
export async function POST(req: Request) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared && declared > env.UPLOAD_MAX_BYTES * 1.05 + 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "Arquivo grande demais." }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Envio inválido." }, { status: 400 });
  }
  const orgSlug = str(form, "orgSlug");
  if (!orgSlug) return NextResponse.json({ ok: false, error: "Organização não informada." }, { status: 400 });
  const actor = await routeActor(req, orgSlug);
  if (!actor) return NextResponse.json({ ok: false, error: "Acesso negado." }, { status: 401 });

  const uploads = form
    .getAll("file")
    .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!uploads.length) return jsonError(new ValidationError("Nenhum arquivo enviado."));
  const fileId = str(form, "fileId");
  if (fileId && uploads.length > 1) return jsonError(new ValidationError("Envie uma nova versão por vez."));

  const tags = (str(form, "tags") ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const meta = {
    fileId,
    clientId: str(form, "clientId"),
    projectId: str(form, "projectId"),
    taskId: str(form, "taskId"),
    requestId: str(form, "requestId"),
    folderId: str(form, "folderId"),
    category: (str(form, "category") ?? "general") as "general",
    tags,
    note: str(form, "note"),
    source: (["upload", "editor", "ai"] as const).find((v) => v === str(form, "source")) ?? "upload",
  };

  const results: { name: string; ok: boolean; fileId?: string; versionId?: string; error?: string }[] = [];
  for (const upload of uploads) {
    try {
      const buffer = Buffer.from(await upload.arrayBuffer());
      // Cada arquivo em sua própria transação: uma falha não desfaz os demais.
      const res = await inOrg(actor, (s) => storeUpload(s, { buffer, originalName: upload.name }, meta));
      results.push({ name: upload.name, ok: true, fileId: res.fileId, versionId: res.versionId });
    } catch (err) {
      if (uploads.length === 1) return jsonError(err);
      results.push({ name: upload.name, ok: false, error: err instanceof Error ? err.message : "Falha no envio" });
    }
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 201 : 207 });
}

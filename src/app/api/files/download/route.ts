import { mustDownload } from "@/server/services/file-type";
import { getStorage } from "@/server/storage";
import { verifyDownload } from "@/server/storage/signing";

export const runtime = "nodejs";

/**
 * Entrega de arquivos do armazenamento local ou no banco por link assinado (HMAC) e com
 * validade curta. Sem assinatura válida, nada é servido.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams;
  const claims = {
    key: q.get("key") ?? "",
    exp: Number(q.get("exp")),
    name: q.get("name") ?? "arquivo",
    disposition: (q.get("disposition") === "attachment" ? "attachment" : "inline") as "inline" | "attachment",
    type: q.get("type") ?? "application/octet-stream",
  };
  if (!verifyDownload(claims, q.get("sig") ?? "")) {
    return new Response("Link inválido ou expirado.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const storage = getStorage();
  // Com S3 os links apontam direto para o bucket (URL pré-assinada).
  if (storage.name === "s3") return new Response("Não encontrado.", { status: 404 });
  try {
    const { body, size } = await storage.stream(claims.key);
    const disposition = mustDownload(claims.type) ? "attachment" : claims.disposition;
    const headers = new Headers({
      "Content-Type": claims.type,
      "Content-Length": String(size),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(claims.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    // Documentos que podem executar scripts são isolados; mídia e PDF são exibidos normalmente.
    const passive = /^(image\/(?!svg)|video\/|audio\/)/.test(claims.type) || claims.type === "application/pdf";
    if (!passive) headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response("Não encontrado.", { status: 404 });
  }
}

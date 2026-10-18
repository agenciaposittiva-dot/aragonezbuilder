import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { inOrg } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";
import { EXPORT_TYPES, exportPage, resolvePeriod, type ExportType } from "@/server/services/reports";

export const dynamic = "force-dynamic";

const PAGE = 1000;
const MAX_ROWS = 100_000;

function csvCell(value: string | number | null) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Evita injeção de fórmulas em planilhas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (cells: (string | number | null)[]) => cells.map(csvCell).join(";") + "\r\n";

/**
 * Exporta dados de relatório em CSV (separador ";", UTF-8 com BOM para Excel).
 * As linhas são lidas em páginas e enviadas em streaming.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") as ExportType | null;
  const orgSlug = url.searchParams.get("org");
  if (!type || !(type in EXPORT_TYPES) || !orgSlug)
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const actor = await resolveActor(session.user.id, orgSlug);
  if (!actor) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let period: ReturnType<typeof resolvePeriod>;
  let first: Awaited<ReturnType<typeof exportPage>>;
  try {
    period = resolvePeriod({
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      clientId: url.searchParams.get("clientId") ?? undefined,
    });
    first = await inOrg(actor, (s) => exportPage(s, type, period, 0, PAGE));
  } catch (err) {
    if (err instanceof AppError)
      return NextResponse.json({ error: err.message }, { status: err.code === "forbidden" ? 403 : 400 });
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode("﻿" + line(first.header)));
        let rows = first.rows;
        let offset = 0;
        while (rows.length) {
          controller.enqueue(encoder.encode(rows.map(line).join("")));
          offset += rows.length;
          if (rows.length < PAGE || offset >= MAX_ROWS) break;
          rows = (await inOrg(actor, (s) => exportPage(s, type, period, offset, PAGE))).rows;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  const filename = `${type}-${period.from}-a-${period.to}.csv`;
  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

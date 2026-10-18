import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  BASIS_LABEL,
  LEVEL3,
  RECOMMENDATION_AREAS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_STATUS,
  type Basis,
  type Level3,
} from "@/lib/brand-radar";
import { inOrg } from "@/server/authz";
import { resolveActor } from "@/server/authz/actor";
import { auth } from "@/server/auth";
import { AppError } from "@/server/errors";
import { recommendationsForExport } from "@/server/services/brand-radar";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Evita injeção de fórmulas em planilhas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(";") + "\r\n";
const level = (v: string) => LEVEL3[v as Level3] ?? v;

/** Plano de ação do Radar de Marca em CSV (separador ";", UTF-8 com BOM para Excel). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orgSlug = url.searchParams.get("org");
  const profileId = url.searchParams.get("profile");
  if (!orgSlug || !profileId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const actor = await resolveActor(session.user.id, orgSlug);
  if (!actor) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let data: Awaited<ReturnType<typeof recommendationsForExport>>;
  try {
    data = await inOrg(actor, (s) => recommendationsForExport(s, profileId));
  } catch (err) {
    if (err instanceof AppError)
      return NextResponse.json({ error: err.message }, { status: err.code === "forbidden" ? 403 : 404 });
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const header = [
    "Diagnóstico de",
    "Categoria",
    "Área",
    "Título",
    "Problema",
    "Evidência",
    "Fonte da evidência",
    "Base",
    "Impacto",
    "Esforço",
    "Prioridade",
    "Confiança",
    "Próxima ação",
    "Como testar",
    "Prazo",
    "Situação",
  ];
  const body = data.rows.map(({ rec, diagnosisAt }) =>
    line([
      diagnosisAt.toISOString().slice(0, 10),
      RECOMMENDATION_CATEGORIES[rec.category],
      RECOMMENDATION_AREAS[rec.area],
      rec.title,
      rec.problem,
      rec.evidence,
      rec.evidenceSource,
      BASIS_LABEL[rec.basis as Basis] ?? rec.basis,
      level(rec.impact),
      level(rec.effort),
      rec.priority,
      level(rec.confidence),
      rec.nextAction,
      rec.howToTest,
      rec.dueDate,
      RECOMMENDATION_STATUS[rec.status],
    ]),
  );
  const csv = "﻿" + line(header) + body.join("");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-de-marca-${data.profile.handle}.csv"`,
      "cache-control": "no-store",
    },
  });
}

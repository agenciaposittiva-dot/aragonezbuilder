import { History } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { describeActions, describeConditions, triggerLabel } from "@/components/automations/describe";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { getRule, listRuns } from "@/server/services/automations";

export const metadata: Metadata = { title: "Execuções da automação" };

const TONE = { success: "success", failed: "danger", skipped: "neutral" } as const;
const LABEL = { success: "Sucesso", failed: "Falhou", skipped: "Ignorada" } as const;

function summarize(result: Record<string, unknown> | null) {
  if (!result) return null;
  if (typeof result.reason === "string") return result.reason;
  const actions = Array.isArray(result.actions) ? (result.actions as Record<string, unknown>[]) : [];
  return actions
    .map((a) => {
      if (a.type === "create_task") return "tarefa criada";
      if (a.type === "notify_members" || a.type === "notify_client")
        return `${a.notified ?? 0} notificado(s)${a.emails ? `, ${a.emails} e-mail(s)` : ""}`;
      if (a.type === "email") return `${a.emails ?? 0} e-mail(s)`;
      if (a.type === "set_task_status") return `status → ${a.status}`;
      if (a.type === "webhook") return `webhook ${a.status}`;
      return String(a.type);
    })
    .join(" · ");
}

export default async function AutomationRunsPage({ params }: PageProps<"/w/[org]/automations/[id]/runs">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "automations.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      return { rule: await getRule(s, id), runs: await listRuns(s, id, 200) };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const { rule, runs } = data;
  return (
    <>
      <Breadcrumbs items={[{ label: "Automações", href: `/w/${actor.orgSlug}/automations` }, { label: rule.name }]} />
      <PageHeader
        title={`Execuções · ${rule.name}`}
        description={`Quando ${triggerLabel(rule.trigger).toLowerCase()} · se ${describeConditions(rule.trigger, rule.conditions).toLowerCase()} · então ${describeActions(rule.actions).toLowerCase()}`}
      />
      <Card>
        {runs.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nenhuma execução ainda"
            description="As execuções aparecem aqui assim que o gatilho acontecer."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Quando</TH>
                <TH>Resultado</TH>
                <TH>Detalhes</TH>
              </tr>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-fg-muted">{formatDateTime(r.startedAt)}</TD>
                  <TD>
                    <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  </TD>
                  <TD className="text-sm">
                    {r.error ? (
                      <span className="text-danger">{r.error}</span>
                    ) : (
                      <span className="text-fg-muted">{summarize(r.result)}</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

import { Plus, Workflow } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { describeActions, describeConditions, triggerLabel } from "@/components/automations/describe";
import { RuleMenu, RuleToggle, SecretField } from "@/components/automations/rule-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { AUTOMATION_PRESETS } from "@/lib/automation-presets";
import { relativeFromNow } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getWebhookSecret, listRules } from "@/server/services/automations";

export const metadata: Metadata = { title: "Automações" };

const STATUS_TONE = { success: "success", failed: "danger", skipped: "neutral" } as const;
const STATUS_LABEL = { success: "Última: sucesso", failed: "Última: falhou", skipped: "Ignorada" } as const;

export default async function AutomationsPage({ params }: PageProps<"/w/[org]/automations">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "automations.read" });
  const { rules, secret } = await inOrg(actor, async (s) => ({
    rules: await listRules(s),
    secret: getWebhookSecret(s),
  }));
  const canManage = can(actor, "automations.manage");
  const base = `/w/${actor.orgSlug}/automations`;

  return (
    <>
      <PageHeader
        title="Automações"
        description="Regras do tipo “quando acontecer X, se Y, faça Z” — avisos, tarefas, e-mails e integrações sem trabalho manual."
        actions={
          canManage ? (
            <Button variant="primary" asChild>
              <Link href={`${base}/new`}>
                <Plus /> Nova automação
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6">
        <Card>
          {rules.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="Nenhuma automação ainda"
              description="Comece por um dos modelos abaixo ou crie uma regra do zero."
            />
          ) : (
            <ul className="divide-y divide-border">
              {rules.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={canManage ? `${base}/${r.id}` : `${base}/${r.id}/runs`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      {!r.enabled ? <Badge tone="outline">Pausada</Badge> : null}
                      {r.lastStatus ? (
                        <Badge tone={STATUS_TONE[r.lastStatus as keyof typeof STATUS_TONE] ?? "neutral"}>
                          {STATUS_LABEL[r.lastStatus as keyof typeof STATUS_LABEL] ?? r.lastStatus}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-fg-muted">
                      <span className="text-fg">Quando</span> {triggerLabel(r.trigger).toLowerCase()} ·{" "}
                      <span className="text-fg">se</span> {describeConditions(r.trigger, r.conditions).toLowerCase()} ·{" "}
                      <span className="text-fg">então</span> {describeActions(r.actions).toLowerCase()}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {r.runs30d} execução(ões) em 30 dias{r.failed30d ? ` · ${r.failed30d} com falha` : ""}
                      {r.lastRunAt ? ` · última ${relativeFromNow(r.lastRunAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <RuleToggle id={r.id} enabled={r.enabled} name={r.name} disabled={!canManage} />
                    <RuleMenu id={r.id} name={r.name} canManage={canManage} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {canManage ? (
          <section className="grid grid-cols-1 gap-3">
            <h2 className="text-sm font-semibold">Modelos prontos</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {AUTOMATION_PRESETS.map((p) => (
                <Link
                  key={p.key}
                  href={`${base}/new?preset=${p.key}`}
                  className="rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong"
                >
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="mt-1 text-xs text-fg-muted">{p.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {secret ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Assinatura dos webhooks</CardTitle>
                <CardDescription>
                  Para conferir que a chamada veio da plataforma, calcule HMAC-SHA256 do corpo com este segredo e
                  compare com o cabeçalho X-Aragonez-Signature (formato sha256=…).
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <SecretField secret={secret} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

import { InfoList, Stat, StatGrid } from "@/components/app/stat";
import { ClientContacts } from "@/components/clients/client-contacts";
import { ClientServices } from "@/components/clients/client-services";
import { ClientTeam } from "@/components/clients/client-team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientStats, getClient } from "@/server/services/clients";
import { listInternalMembers } from "@/server/services/members";

export default async function ClientOverviewPage({ params }: PageProps<"/w/[org]/clients/[id]">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const { detail, stats, members } = await inOrg(actor, async (s) => ({
    detail: await getClient(s, id),
    stats: await clientStats(s, id),
    members: await listInternalMembers(s),
  }));
  const { client, contacts, team, services } = detail;
  const base = `/w/${actor.orgSlug}`;
  const canWrite = can(actor, "clients.write");

  return (
    <div className="grid gap-6">
      <StatGrid>
        <Stat
          label="Projetos ativos"
          value={stats.activeProjects}
          hint={`${stats.doneProjects} concluídos`}
          href={`${base}/clients/${id}/projects`}
        />
        <Stat label="Solicitações abertas" value={stats.openRequests} href={`${base}/clients/${id}/requests`} />
        <Stat
          label="Aprovações pendentes"
          value={stats.pendingApprovals}
          tone={stats.pendingApprovals ? "warning" : undefined}
        />
        <Stat label="Tarefas atrasadas" value={stats.overdueTasks} tone={stats.overdueTasks ? "danger" : undefined} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Dados cadastrais</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoList
                items={[
                  { label: "Razão social", value: client.legalName },
                  { label: "CNPJ / CPF", value: client.document },
                  {
                    label: "E-mail",
                    value: client.email ? (
                      <a className="hover:underline" href={`mailto:${client.email}`}>
                        {client.email}
                      </a>
                    ) : null,
                  },
                  { label: "Telefone", value: client.phone },
                  {
                    label: "Site",
                    value: client.website ? (
                      <a
                        className="hover:underline"
                        href={client.website.startsWith("http") ? client.website : `https://${client.website}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {client.website}
                      </a>
                    ) : null,
                  },
                  { label: "Segmento", value: client.industry },
                  { label: "Endereço", value: client.address },
                  { label: "Cliente desde", value: formatDate(client.createdAt) },
                ]}
              />
            </CardContent>
          </Card>

          <ClientServices
            clientId={id}
            services={services}
            canWrite={canWrite}
            canSeeMoney={can(actor, "finance.read")}
            canEditMoney={can(actor, "finance.write")}
          />

          {client.notesInternal ? (
            <Card>
              <CardHeader>
                <CardTitle>Observações internas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg-muted">{client.notesInternal}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <ClientTeam
            clientId={id}
            team={team}
            members={members.map((m) => ({
              membershipId: m.membershipId,
              name: m.name,
              image: m.image,
              jobTitle: m.jobTitle,
              roleName: m.roleName,
            }))}
            canWrite={canWrite}
          />
          <ClientContacts clientId={id} contacts={contacts} canWrite={canWrite} />
        </div>
      </div>
    </div>
  );
}

import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { RoutineFormDialog, RoutinesTable } from "@/components/tasks/routines-manager";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listInternalMembers } from "@/server/services/members";
import { projectOptions } from "@/server/services/projects";
import { listRoutines } from "@/server/services/task-routines";

export const metadata: Metadata = { title: "Rotina" };

/** Tarefas recorrentes da agência e dos clientes (geradas automaticamente na data). */
export default async function RoutinesPage({ params }: PageProps<"/w/[org]/rotina">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "tasks.read" });
  const canWrite = can(actor, "tasks.write");
  const data = await inOrg(actor, async (s) => ({
    rows: await listRoutines(s),
    projects: canWrite ? await projectOptions(s) : [],
    members: canWrite ? await listInternalMembers(s) : [],
  }));
  const projects = data.projects.map((p) => ({ id: p.id, name: p.name, clientName: p.clientName }));
  const members = data.members.map((m) => ({ membershipId: m.membershipId, name: m.name }));
  return (
    <>
      <PageHeader
        title="Rotina"
        description="Tarefas que se repetem — organização, relatórios, escala de stories. Cada uma é criada no dia certo, no projeto escolhido, uma única vez por data."
        actions={
          canWrite ? (
            <RoutineFormDialog
              projects={projects}
              members={members}
              trigger={
                <Button variant="primary">
                  <Plus /> Nova rotina
                </Button>
              }
            />
          ) : null
        }
      />
      <Card>
        <RoutinesTable rows={data.rows} projects={projects} members={members} canWrite={canWrite} />
      </Card>
    </>
  );
}

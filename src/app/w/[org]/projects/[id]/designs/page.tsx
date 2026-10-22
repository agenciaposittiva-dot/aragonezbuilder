import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkedDesigns } from "@/components/studio/linked-designs";
import { NewDesignDialog } from "@/components/studio/new-design-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { listDesigns } from "@/server/services/designs";
import { getProject } from "@/server/services/projects";

/** Artes do Estúdio deste projeto (as das demandas dele também aparecem aqui). */
export default async function ProjectDesignsPage({ params }: PageProps<"/w/[org]/projects/[id]/designs">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "designs.read" });
  const data = await inOrg(actor, async (s) => {
    try {
      const p = await getProject(s, id);
      return { project: p.project, clientName: p.clientName, designs: await listDesigns(s, { projectId: id }) };
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  });
  if (!data) notFound();
  const base = `/w/${actor.orgSlug}`;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Artes do projeto</CardTitle>
          <p className="mt-0.5 text-xs text-fg-muted">
            Artes e carrosséis criados no Estúdio para este projeto e para as demandas dele.
          </p>
        </div>
        {can(actor, "designs.write") ? (
          <div className="flex flex-wrap gap-2">
            {can(actor, "ai.use") ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`${base}/studio/gerar?clientId=${data.project.clientId}`}>
                  <Sparkles /> Gerar carrossel com IA
                </Link>
              </Button>
            ) : null}
            <NewDesignDialog
              clients={[]}
              projects={[]}
              templates={[]}
              canManageTemplates={false}
              link={{
                clientId: data.project.clientId,
                projectId: id,
                label: `${data.clientName} · ${data.project.name}`,
              }}
              trigger={
                <Button variant="primary" size="sm">
                  <Plus /> Nova arte
                </Button>
              }
            />
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <LinkedDesigns designs={data.designs} base={base} empty="Nenhuma arte neste projeto ainda." />
      </CardContent>
    </Card>
  );
}

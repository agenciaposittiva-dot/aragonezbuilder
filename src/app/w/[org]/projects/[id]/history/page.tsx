import { HistoryList } from "@/components/app/history-list";
import { Card, CardContent } from "@/components/ui/card";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { projectHistory } from "@/server/services/projects";

export default async function ProjectHistoryPage({ params }: PageProps<"/w/[org]/projects/[id]/history">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "projects.read" });
  const entries = await inOrg(actor, (s) => projectHistory(s, id, 150));
  return (
    <Card>
      <CardContent className="pt-5">
        <HistoryList entries={entries} />
      </CardContent>
    </Card>
  );
}

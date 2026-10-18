import { HistoryList } from "@/components/app/history-list";
import { Card, CardContent } from "@/components/ui/card";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientHistory } from "@/server/services/clients";

export default async function ClientHistoryPage({ params }: PageProps<"/w/[org]/clients/[id]/history">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const entries = await inOrg(actor, (s) => clientHistory(s, id, 100));
  return (
    <Card>
      <CardContent className="pt-5">
        <HistoryList entries={entries} />
      </CardContent>
    </Card>
  );
}

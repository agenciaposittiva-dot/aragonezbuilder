"use client";

import { Crown, Pencil } from "lucide-react";
import { useState } from "react";
import { MemberPicker, type MemberLite } from "@/components/app/member-picker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrgAction } from "@/hooks/use-action";
import { setClientMembersAction } from "@/server/actions/clients";

type TeamMember = {
  membershipId: string;
  role: "lead" | "member";
  name: string;
  image: string | null;
  jobTitle: string | null;
};

export function ClientTeam({
  clientId,
  team,
  members,
  canWrite,
}: {
  clientId: string;
  team: TeamMember[];
  members: MemberLite[];
  canWrite: boolean;
}) {
  const [ids, setIds] = useState(team.map((t) => t.membershipId));
  const leadId = team.find((t) => t.role === "lead")?.membershipId;
  const save = useOrgAction(setClientMembersAction, { success: "Equipe atualizada" });

  function persist(next: string[], nextLead = leadId) {
    setIds(next);
    const lead = nextLead && next.includes(nextLead) ? nextLead : next[0];
    save.run({
      clientId,
      members: next.map((membershipId) => ({ membershipId, role: membershipId === lead ? "lead" : "member" })),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipe responsável</CardTitle>
        {canWrite ? (
          <MemberPicker
            members={members}
            value={ids}
            onChange={(next) => persist(next)}
            trigger={
              <Button variant="ghost" size="icon-xs" aria-label="Editar equipe">
                <Pencil />
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent>
        {team.length === 0 ? (
          <p className="text-sm text-fg-muted">Nenhum responsável definido.</p>
        ) : (
          <ul className="grid gap-2.5">
            {team.map((m) => (
              <li key={m.membershipId} className="flex items-center gap-3">
                <Avatar name={m.name} src={m.image} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-fg-muted">
                    {m.role === "lead" ? "Responsável principal" : (m.jobTitle ?? "Equipe")}
                  </p>
                </div>
                {m.role === "lead" ? (
                  <Crown className="size-4 text-accent-text" aria-label="Responsável principal" />
                ) : canWrite ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => persist(ids, m.membershipId)}
                    disabled={save.pending}
                  >
                    Tornar principal
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

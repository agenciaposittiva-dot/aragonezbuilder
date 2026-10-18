"use client";

import { Pencil } from "lucide-react";
import { MemberPicker, type MemberLite } from "@/components/app/member-picker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrgAction } from "@/hooks/use-action";
import { setProjectMembersAction } from "@/server/actions/projects";

export function ProjectTeam({
  projectId,
  team,
  members,
  ownerId,
  canWrite,
}: {
  projectId: string;
  team: { membershipId: string; name: string; image: string | null; email: string }[];
  members: MemberLite[];
  ownerId: string | null;
  canWrite: boolean;
}) {
  const save = useOrgAction(setProjectMembersAction, { success: "Equipe atualizada" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipe</CardTitle>
        {canWrite ? (
          <MemberPicker
            members={members}
            value={team.map((t) => t.membershipId)}
            onChange={(ids) => save.run({ projectId, membershipIds: ids })}
            trigger={
              <Button variant="ghost" size="icon-xs" aria-label="Editar equipe">
                <Pencil />
              </Button>
            }
          />
        ) : null}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2.5">
          {team.map((m) => (
            <li key={m.membershipId} className="flex items-center gap-3">
              <Avatar name={m.name} src={m.image} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-fg-muted">
                  {m.membershipId === ownerId ? "Responsável pelo projeto" : m.email}
                </p>
              </div>
            </li>
          ))}
          {!team.length ? <li className="text-sm text-fg-muted">Ninguém na equipe.</li> : null}
        </ul>
      </CardContent>
    </Card>
  );
}

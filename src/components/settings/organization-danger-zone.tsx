"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeleteDialog } from "@/components/app/delete-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { organizationDeletionImpactAction, trashOrganizationAction } from "@/server/actions/trash";

/** Exclusão da agência (somente o proprietário). Vai para a lixeira por 30 dias. */
export function OrganizationDangerZone({ name, slug }: { name: string; slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Card className="max-w-3xl border-danger/40">
      <CardHeader>
        <div>
          <CardTitle>Excluir agência</CardTitle>
          <CardDescription>
            Todos perdem o acesso na hora — equipe e convidados — e os portais dos clientes saem do ar. Você pode
            restaurar a agência por 30 dias; depois disso, tudo é apagado definitivamente.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button variant="danger" onClick={() => setOpen(true)}>
          <Trash2 /> Excluir agência
        </Button>
        <DeleteDialog
          open={open}
          onOpenChange={setOpen}
          kindLabel="agência"
          name={name}
          description="A agência vai para a Lixeira com todos os clientes, projetos e arquivos. Ninguém consegue entrar enquanto ela estiver lá. Somente você, como proprietário, pode restaurá-la nos próximos 30 dias."
          typeToConfirm
          confirmLabel="Excluir agência"
          loadImpact={(org) => organizationDeletionImpactAction(org, {})}
          onDelete={(org, o) => trashOrganizationAction(org, { confirmName: o.confirmName })}
          successMessage={`Agência “${name}” movida para a lixeira`}
          onDeleted={() => router.replace(`/onboarding?excluida=${encodeURIComponent(slug)}`)}
        />
      </CardContent>
    </Card>
  );
}

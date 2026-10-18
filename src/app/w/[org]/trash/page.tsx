import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrashItemActions } from "@/components/trash/trash-item-actions";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate, formatDateTime } from "@/lib/format";
import { canAny, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { listTrash, TRASH_DAYS, type TrashKind } from "@/server/services/trash";

export const metadata: Metadata = { title: "Lixeira" };

const KIND: Record<TrashKind, string> = { client: "Cliente", project: "Projeto", design: "Arte" };

export default async function TrashPage({ params }: PageProps<"/w/[org]/trash">) {
  const { org } = await params;
  const actor = await requireActor(org, { kind: "internal" });
  if (!canAny(actor, "clients.delete", "projects.delete", "designs.delete")) notFound();
  const items = await inOrg(actor, listTrash);

  return (
    <>
      <PageHeader
        title="Lixeira"
        description={`Clientes, projetos e artes excluídos ficam aqui por ${TRASH_DAYS} dias e podem ser restaurados. Depois disso, são apagados definitivamente.${actor.dataAll ? "" : " Você vê apenas o que você mesmo excluiu."}`}
      />
      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={Trash2}
            title="A lixeira está vazia"
            description="Ao excluir um cliente, projeto ou arte, ele aparece aqui até ser restaurado ou apagado de vez."
          />
        </div>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {items.map((item) => {
              const daysLeft = item.daysLeft;
              return (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                        {KIND[item.kind]}
                      </span>
                      <span className="truncate font-medium">{item.name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {item.detail ? `${item.detail} · ` : ""}
                      Excluído em <time dateTime={item.deletedAt.toISOString()}>{formatDateTime(item.deletedAt)}</time>
                      {item.deletedByName ? ` por ${item.deletedByName}` : ""}
                    </p>
                    <p className={`mt-0.5 text-xs ${daysLeft <= 3 ? "text-danger" : "text-fg-subtle"}`}>
                      Apagado definitivamente em {formatDate(item.purgeAt)} ({daysLeft}{" "}
                      {daysLeft === 1 ? "dia" : "dias"})
                    </p>
                    {item.blockedBy ? <p className="mt-1 text-xs text-warning">{item.blockedBy}</p> : null}
                  </div>
                  <TrashItemActions kind={item.kind} id={item.id} name={item.name} blocked={!!item.blockedBy} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

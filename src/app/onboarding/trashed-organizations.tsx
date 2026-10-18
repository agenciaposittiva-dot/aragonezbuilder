"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreOrganizationAction } from "@/server/actions/trash";

type Item = { id: string; name: string; purgeLabel: string; daysLeft: number };

/** Agências na lixeira das quais a pessoa é proprietária. */
export function TrashedOrganizations({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-labelledby="lixeira-agencias">
      <h2 id="lixeira-agencias" className="text-sm font-semibold">
        Agências na lixeira
      </h2>
      <p className="mt-0.5 text-xs text-fg-muted">Restaure para devolver o acesso a todos, com os dados intactos.</p>
      <ul className="mt-3 grid gap-2">
        {items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{o.name}</span>
              <span className={`block text-xs ${o.daysLeft <= 3 ? "text-danger" : "text-fg-muted"}`}>
                Apagada definitivamente em {o.purgeLabel}
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === o.id}
              disabled={!!busy}
              onClick={async () => {
                setBusy(o.id);
                const res = await restoreOrganizationAction(o.id).catch(() => null);
                setBusy(null);
                if (res?.ok) {
                  toast.success(`Agência “${res.data.name}” restaurada`);
                  router.push(`/w/${res.data.slug}`);
                } else {
                  toast.error(res && !res.ok ? res.error : "Falha de conexão. Tente novamente.");
                }
              }}
            >
              <RotateCcw /> Restaurar
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

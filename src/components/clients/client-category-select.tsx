"use client";

import { useState } from "react";
import { NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { setClientCategoryAction } from "@/server/actions/clients";

/**
 * Troca a categoria do cliente direto na lista. A mudança aparece na hora e
 * volta se o servidor recusar; o cliente continua o mesmo (nada é copiado).
 */
export function ClientCategorySelect({
  clientId,
  clientName,
  value,
  categories,
}: {
  clientId: string;
  clientName: string;
  value: string | null;
  categories: { id: string; name: string }[];
}) {
  const [current, setCurrent] = useState(value ?? "");
  const move = useOrgAction(setClientCategoryAction, { success: "Categoria atualizada" });
  return (
    <NativeSelect
      aria-label={`Categoria de ${clientName}`}
      value={current}
      disabled={move.pending}
      // A linha inteira é um link: o seletor fica por cima e não navega.
      className="relative z-[1] h-8 w-full max-w-48 text-xs"
      onChange={async (e) => {
        const before = current;
        const next = e.target.value;
        setCurrent(next);
        const res = await move.run({ clientId, categoryId: next || null });
        if (!res.ok) setCurrent(before);
      }}
    >
      <option value="">Sem categoria</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
}

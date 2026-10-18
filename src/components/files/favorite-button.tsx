"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import { useOrgAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { toggleFavoriteAction } from "@/server/actions/files";

export function FavoriteButton({
  fileId,
  initial,
  className,
}: {
  fileId: string;
  initial: boolean;
  className?: string;
}) {
  const [fav, setFav] = useState(initial);
  const toggle = useOrgAction(toggleFavoriteAction, {
    onSuccess: (d) => setFav(d.favorite),
    onError: () => setFav((v) => !v),
  });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setFav((v) => !v);
        toggle.run({ fileId });
      }}
      aria-pressed={fav}
      aria-label={fav ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      className={cn(
        "rounded-md p-1 transition-colors hover:bg-surface-2",
        fav ? "text-accent" : "text-fg-subtle",
        className,
      )}
    >
      <Star className={cn("size-4", fav && "fill-accent")} />
    </button>
  );
}

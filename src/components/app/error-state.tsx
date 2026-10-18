"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Estado de erro para boundaries (error.tsx) com opção de tentar de novo. */
export function ErrorState({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <div>
        <h1 className="text-base font-semibold">Algo deu errado ao carregar esta página</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Tente novamente. Se o problema continuar, informe o código abaixo ao suporte.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-fg-subtle">Código: {error.digest}</p> : null}
      </div>
      <Button variant="primary" onClick={reset}>
        <RotateCcw /> Tentar novamente
      </Button>
    </div>
  );
}

"use client";

import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/shell/workspace-context";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]> };

/**
 * Executa uma Server Action da organização atual com estado de carregamento,
 * mensagem de sucesso/erro e retorno dos erros de campo.
 */
export function useOrgAction<I, T>(
  action: (orgSlug: string, input: I) => Promise<Result<T>>,
  opts: { success?: string | ((data: T) => string); onSuccess?: (data: T) => void; onError?: (error: string) => void } = {},
) {
  const { orgSlug } = useWorkspace();
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const run = useCallback(
    (input: I) =>
      new Promise<Result<T>>((resolve) => {
        start(async () => {
          let res: Result<T>;
          try {
            res = await action(orgSlug, input);
          } catch {
            res = { ok: false, error: "Falha de conexão. Verifique a internet e tente novamente." };
          }
          if (res.ok) {
            setFieldErrors({});
            if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(res.data) : opts.success);
            opts.onSuccess?.(res.data);
          } else {
            setFieldErrors(res.fieldErrors ?? {});
            toast.error(res.error);
            opts.onError?.(res.error);
          }
          resolve(res);
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, orgSlug, opts.success, opts.onSuccess, opts.onError],
  );

  return { run, pending, fieldErrors };
}

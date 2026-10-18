"use client";

import { Laptop, LogOut, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { formatDateTime } from "@/lib/format";

type SessionItem = {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function describe(ua?: string | null) {
  if (!ua) return { label: "Dispositivo desconhecido", mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Navegador";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { label: os ? `${browser} · ${os}` : browser, mobile };
}

/** Sessões ativas da conta, com encerramento individual ou de todas as outras. */
export function SessionsList() {
  const { data: current } = authClient.useSession();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const { data } = await authClient.listSessions();
    setSessions((data as SessionItem[] | null) ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega dados do servidor de autenticação
    void load();
  }, [load]);

  const currentToken = current?.session.token;
  const others = (sessions ?? []).filter((s) => s.token !== currentToken);

  return (
    <div className="grid gap-4">
      {sessions === null ? (
        <p className="text-sm text-fg-muted">Carregando sessões…</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sessions.map((s) => {
            const d = describe(s.userAgent);
            const isCurrent = s.token === currentToken;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                {d.mobile ? (
                  <Smartphone className="size-4 text-fg-subtle" />
                ) : (
                  <Laptop className="size-4 text-fg-subtle" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {d.label}
                    {isCurrent ? <Badge tone="success">Esta sessão</Badge> : null}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {s.ipAddress ? `${s.ipAddress} · ` : ""}último acesso {formatDateTime(s.updatedAt)}
                  </p>
                </div>
                {!isCurrent ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const { error } = await authClient.revokeSession({ token: s.token });
                        if (error) toast.error("Não foi possível encerrar a sessão.");
                        else toast.success("Sessão encerrada");
                        await load();
                      })
                    }
                  >
                    <LogOut /> Encerrar
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {others.length ? (
        <div>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const { error } = await authClient.revokeOtherSessions();
                if (error) toast.error("Não foi possível encerrar as sessões.");
                else toast.success("Outras sessões encerradas");
                await load();
              })
            }
          >
            Encerrar todas as outras sessões
          </Button>
        </div>
      ) : null}
    </div>
  );
}

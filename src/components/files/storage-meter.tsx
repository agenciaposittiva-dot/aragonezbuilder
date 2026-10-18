import { AlertTriangle, HardDrive } from "lucide-react";
import Link from "next/link";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StorageUsage } from "@/server/services/files";

const DRIVER: Record<StorageUsage["driver"], string> = {
  database: "no banco de dados (Postgres)",
  blob: "no Vercel Blob",
  s3: "em armazenamento S3",
  local: "no disco do servidor",
};

/**
 * Uso real do armazenamento. Sem cota definida pela agência, mostra só o
 * total (o limite é o do plano do provedor — não prometemos "ilimitado").
 */
export function StorageMeter({ usage, settingsHref }: { usage: StorageUsage; settingsHref: string | null }) {
  const pct = usage.percent;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs" data-testid="storage-meter">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium text-fg">
          <HardDrive className="size-3.5" />
          {formatBytes(usage.usedBytes)}
          {usage.quotaBytes ? ` de ${formatBytes(usage.quotaBytes)}` : " usados"}
        </span>
        {settingsHref ? (
          <Link href={settingsHref} className="text-fg-muted hover:text-fg">
            {usage.quotaBytes ? "Cota" : "Definir cota"}
          </Link>
        ) : null}
      </div>
      {pct !== null ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Uso da cota de armazenamento"
        >
          <div
            className={cn("h-full rounded-full", usage.alert ? "bg-warning" : "bg-accent")}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      <p className="mt-1.5 text-fg-muted">
        {usage.files} arquivos · {usage.versions} versões · guardados {DRIVER[usage.driver]}
        {usage.trashBytes ? ` · ${formatBytes(usage.trashBytes)} na lixeira` : ""}
      </p>
      {usage.quotaBytes === null ? (
        <p className="mt-0.5 text-fg-subtle">Sem cota da agência: vale o limite do plano do provedor.</p>
      ) : null}
      {usage.alert ? (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {pct}% da cota usada. Libere espaço na Lixeira ou
          aumente a cota.
        </p>
      ) : null}
    </div>
  );
}

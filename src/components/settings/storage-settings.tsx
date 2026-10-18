"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { formatBytes } from "@/lib/format";
import { updateStorageSettingsAction } from "@/server/actions/settings";

type Props = {
  storage: {
    quotaBytes: number | null;
    alertPercent: number;
    designVersionRetention: number;
    versionCheckpointMinutes: number;
  };
  usedBytes: number;
  driverLabel: string;
};

/** Cota de armazenamento da agência e política de versões das artes. */
export function StorageSettings({ storage, usedBytes, driverLabel }: Props) {
  const [quota, setQuota] = useState(storage.quotaBytes ? String(+(storage.quotaBytes / 1024 ** 3).toFixed(2)) : "");
  const [alert, setAlert] = useState(String(storage.alertPercent));
  const [retention, setRetention] = useState(String(storage.designVersionRetention));
  const [checkpoint, setCheckpoint] = useState(String(storage.versionCheckpointMinutes));
  const save = useOrgAction(updateStorageSettingsAction, { success: "Armazenamento atualizado" });

  return (
    <Card id="armazenamento" className="max-w-3xl scroll-mt-20">
      <CardHeader>
        <div>
          <CardTitle>Armazenamento e versões</CardTitle>
          <CardDescription>
            Em uso: {formatBytes(usedBytes)}, guardados {driverLabel}. A cota é um limite da agência; o limite real
            também depende do plano do provedor.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.run({
              quotaGb: quota.trim() ? Number(quota.replace(",", ".")) : null,
              alertPercent: Number(alert),
              designVersionRetention: Number(retention),
              versionCheckpointMinutes: Number(checkpoint),
            });
          }}
        >
          <Field
            label="Cota da agência (GB)"
            htmlFor="st-quota"
            hint="Vazio = sem cota própria. Envios acima da cota são recusados."
            error={save.fieldErrors.quotaGb}
          >
            <Input id="st-quota" inputMode="decimal" value={quota} onChange={(e) => setQuota(e.target.value)} />
          </Field>
          <Field label="Avisar a partir de (%)" htmlFor="st-alert" error={save.fieldErrors.alertPercent}>
            <Input
              id="st-alert"
              type="number"
              min={50}
              max={99}
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
            />
          </Field>
          <Field
            label="Versões automáticas por arte"
            htmlFor="st-retention"
            hint="As mais antigas são apagadas; versões nomeadas ficam sempre."
            error={save.fieldErrors.designVersionRetention}
          >
            <Input
              id="st-retention"
              type="number"
              min={5}
              max={500}
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </Field>
          <Field
            label="Intervalo entre pontos de controle (min)"
            htmlFor="st-checkpoint"
            hint="Uma versão automática no máximo a cada intervalo de edição."
            error={save.fieldErrors.versionCheckpointMinutes}
          >
            <Input
              id="st-checkpoint"
              type="number"
              min={1}
              max={240}
              value={checkpoint}
              onChange={(e) => setCheckpoint(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" loading={save.pending}>
              Salvar armazenamento
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

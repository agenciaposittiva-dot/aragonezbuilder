"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { useOrgAction } from "@/hooks/use-action";
import {
  NOTIFICATION_CATEGORIES,
  prefEnabled,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPrefs,
} from "@/lib/notification-prefs";
import { updateNotificationPreferencesAction } from "@/server/actions/notification-preferences";

/** Quais avisos a pessoa quer receber, na plataforma e por e-mail. */
export function NotificationPreferencesForm({
  initial,
  categories,
  emailConfigured,
}: {
  initial: NotificationPrefs;
  categories: NotificationCategory[];
  emailConfigured: boolean;
}) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const save = useOrgAction(updateNotificationPreferencesAction, { success: "Preferências salvas" });

  function toggle(channel: NotificationChannel, cat: NotificationCategory, value: boolean) {
    setPrefs((p) => ({ ...p, [channel]: { ...p[channel], [cat]: value } }));
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.run(prefs);
      }}
    >
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs font-medium text-fg-muted">
          <span>Assunto</span>
          <span className="text-center">Plataforma</span>
          <span className="text-center">E-mail</span>
        </div>
        <ul className="divide-y divide-border">
          {categories.map((cat) => {
            const c = NOTIFICATION_CATEGORIES[cat];
            return (
              <li key={cat} className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-xs text-fg-muted">{c.description}</span>
                </span>
                <span className="flex justify-center">
                  <Switch
                    checked={prefEnabled(prefs, "inApp", cat)}
                    onCheckedChange={(v) => toggle("inApp", cat, v)}
                    aria-label={`${c.label} na plataforma`}
                  />
                </span>
                <span className="flex justify-center">
                  <Switch
                    checked={prefEnabled(prefs, "email", cat)}
                    onCheckedChange={(v) => toggle("email", cat, v)}
                    aria-label={`${c.label} por e-mail`}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {!emailConfigured ? (
        <p className="text-xs text-fg-muted">
          O envio de e-mails ainda não está configurado nesta instalação: por enquanto, os avisos aparecem só na
          plataforma.
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" loading={save.pending}>
          Salvar preferências
        </Button>
      </div>
    </form>
  );
}

"use client";

import { BellRing, Volume2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useChatAlerts, type SoundTest } from "@/components/chat/chat-alerts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/input";
import { useOrgAction } from "@/hooks/use-action";
import { ALERT_DURATIONS, type ChatAlertPrefs } from "@/lib/chat-alerts";
import { updateChatAlertsAction } from "@/server/actions/notification-preferences";

const DURATION_LABEL: Record<number, string> = {
  5: "5 segundos",
  8: "8 segundos",
  12: "12 segundos",
  20: "20 segundos",
  0: "Só quando eu fechar",
};

const TEST_MESSAGE: Record<SoundTest, string> = {
  played: "Som tocado. Se não ouviu, confira o volume do aparelho.",
  blocked:
    "O navegador bloqueou o som deste site. Libere o som nas permissões do site (ícone ao lado do endereço) e tente de novo.",
  unsupported: "Este navegador não permite tocar sons de aviso.",
  "device-off": "O som está desligado neste aparelho. Use “Ativar sons de notificação” para ligar.",
};

/** Janela flutuante, som e notificações do sistema para mensagens do chat (preferência da conta). */
export function ChatAlertsForm({ initial, chatHref }: { initial: ChatAlertPrefs; chatHref: string }) {
  const alerts = useChatAlerts();
  const [prefs, setPrefs] = useState<ChatAlertPrefs>(alerts?.prefs ?? initial);
  const [testResult, setTestResult] = useState<SoundTest | null>(null);
  const ids = useId();
  const save = useOrgAction(updateChatAlertsAction, {
    success: "Avisos de mensagens salvos",
    onSuccess: (data) => alerts?.applyPrefs(data),
  });

  const set = <K extends keyof ChatAlertPrefs>(key: K, value: ChatAlertPrefs[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const sound = alerts?.sound ?? "unsupported";
  const device = alerts?.deviceSound ?? null;
  const permission = alerts?.nativePermission ?? "unsupported";

  const deviceStatus =
    sound === "unsupported"
      ? "Este navegador não permite tocar sons de aviso."
      : device === "off"
        ? "Som desligado neste aparelho."
        : sound === "ready"
          ? "Som liberado neste navegador."
          : sound === "blocked"
            ? "O navegador bloqueou o som deste site. Libere o som nas permissões do site (ícone ao lado do endereço) e clique em “Ativar sons de notificação”."
            : "O navegador libera o som depois do primeiro clique na página.";

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.run(prefs);
      }}
    >
      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Dentro da plataforma</legend>
        <Row
          id={`${ids}-floating`}
          label="Notificações flutuantes"
          hint="Aparecem no canto superior direito, em qualquer página. Clique para abrir a conversa; dispensar não apaga nada."
        >
          <Switch id={`${ids}-floating`} checked={prefs.floating} onCheckedChange={(v) => set("floating", v)} />
        </Row>
        <Row
          id={`${ids}-duration`}
          label="Fechar automaticamente"
          hint="Com o mouse ou o foco sobre a notificação, ela não fecha. Menções ficam o dobro do tempo."
        >
          <NativeSelect
            id={`${ids}-duration`}
            className="w-44"
            value={String(prefs.duration)}
            disabled={!prefs.floating}
            onChange={(e) => set("duration", Number(e.target.value) as ChatAlertPrefs["duration"])}
          >
            {ALERT_DURATIONS.map((d) => (
              <option key={d} value={d}>
                {DURATION_LABEL[d]}
              </option>
            ))}
          </NativeSelect>
        </Row>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Som</legend>
        <Row
          id={`${ids}-sound`}
          label="Tocar som para mensagens recebidas"
          hint="Um toque curto e discreto; nunca para as suas próprias mensagens."
        >
          <Switch id={`${ids}-sound`} checked={prefs.sound} onCheckedChange={(v) => set("sound", v)} />
        </Row>
        <Row id={`${ids}-volume`} label="Volume" hint={`${prefs.volume}%`}>
          <input
            id={`${ids}-volume`}
            type="range"
            min={5}
            max={100}
            step={5}
            value={prefs.volume}
            disabled={!prefs.sound}
            onChange={(e) => set("volume", Number(e.target.value))}
            className="w-44 accent-[var(--accent)]"
            aria-valuetext={`${prefs.volume}%`}
          />
        </Row>
        <Row
          id={`${ids}-active`}
          label="Na conversa que está aberta"
          hint="A mensagem aparece no próprio chat, sem janela flutuante."
        >
          <NativeSelect
            id={`${ids}-active`}
            className="w-44"
            value={prefs.activeSound}
            disabled={!prefs.sound}
            onChange={(e) => set("activeSound", e.target.value as ChatAlertPrefs["activeSound"])}
          >
            <option value="off">Sem som</option>
            <option value="soft">Som reduzido</option>
            <option value="normal">Som normal</option>
          </NativeSelect>
        </Row>
        <div className="grid gap-2 rounded-lg bg-surface-2 p-3 text-sm">
          <p className="flex items-start gap-2 text-fg-muted">
            <Volume2 className="mt-0.5 size-4 shrink-0" />
            <span>{deviceStatus}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!alerts?.enabled || sound === "unsupported"}
              onClick={async () => setTestResult((await alerts?.testSound(prefs.volume)) ?? "unsupported")}
            >
              Testar som
            </Button>
            {sound !== "ready" || device === "off" ? (
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={!alerts?.enabled || sound === "unsupported"}
                onClick={async () => setTestResult((await alerts?.enableSound(prefs.volume)) ?? "unsupported")}
              >
                Ativar sons de notificação
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  alerts?.muteDevice();
                  setTestResult(null);
                }}
              >
                Não tocar som neste aparelho
              </Button>
            )}
          </div>
          <p role="status" aria-live="polite" className="text-xs text-fg-muted empty:hidden">
            {testResult ? TEST_MESSAGE[testResult] : ""}
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-semibold">Notificações do sistema</legend>
        <p className="-mt-1 text-xs text-fg-muted">
          Diferentes das notificações da plataforma: aparecem na central de notificações do computador ou do celular
          quando a aba está em segundo plano, e dependem da sua autorização em cada navegador.
        </p>
        <Row id={`${ids}-native`} label="Usar notificações do sistema" hint={nativeHint(permission)}>
          <Switch
            id={`${ids}-native`}
            checked={prefs.native}
            onCheckedChange={async (v) => {
              set("native", v);
              if (v && permission === "default") await alerts?.requestNative();
            }}
          />
        </Row>
        {prefs.native && permission === "default" ? (
          <div>
            <Button type="button" size="sm" onClick={() => void alerts?.requestNative()}>
              <BellRing /> Permitir neste navegador
            </Button>
          </div>
        ) : null}
        <Row
          id={`${ids}-preview`}
          label="Mostrar o trecho da mensagem"
          hint="Desligado, a notificação diz só quem escreveu. Ligado, o sistema pode mostrar o texto até na tela de bloqueio."
        >
          <Switch
            id={`${ids}-preview`}
            checked={prefs.nativePreview}
            disabled={!prefs.native}
            onCheckedChange={(v) => set("nativePreview", v)}
          />
        </Row>
      </fieldset>

      <p className="text-xs text-fg-muted">
        Para silenciar uma conversa, um grupo ou um canal, abra-o no{" "}
        <Link href={chatHref} className="text-accent-text underline-offset-4 hover:underline">
          Chat da Equipe
        </Link>{" "}
        e use o menu da conversa (silenciar ou receber só menções). Conversas silenciadas não mostram janela nem tocam
        som.
      </p>

      <div>
        <Button type="submit" variant="primary" loading={save.pending}>
          Salvar avisos
        </Button>
      </div>
    </form>
  );
}

function nativeHint(permission: string) {
  switch (permission) {
    case "granted":
      return "Autorizadas neste navegador.";
    case "denied":
      return "Bloqueadas neste navegador. Para liberar, use as permissões do site (ícone ao lado do endereço).";
    case "default":
      return "Ainda não autorizadas neste navegador: ele vai perguntar quando você permitir.";
    default:
      return "Este navegador não oferece notificações do sistema.";
  }
}

function Row({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

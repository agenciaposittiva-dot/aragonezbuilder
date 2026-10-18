/*
 * Avisos de mensagens novas do Chat da Equipe: janela flutuante dentro da
 * plataforma, som e (opcional) notificações do sistema operacional. Guardados
 * na conta (notification_preferences.alerts), valem em todos os aparelhos.
 * O desbloqueio do áudio é do navegador e fica só no aparelho.
 */

export const ALERT_DURATIONS = [5, 8, 12, 20, 0] as const;
export const ACTIVE_CONVERSATION_SOUND = ["off", "soft", "normal"] as const;

export type ChatAlertPrefs = {
  /** Janela flutuante dentro da plataforma. */
  floating: boolean;
  /** Fecha sozinha após N segundos (0 = só quando a pessoa fechar). */
  duration: (typeof ALERT_DURATIONS)[number];
  /** Som para mensagens recebidas. */
  sound: boolean;
  /** Volume do som, de 5 a 100. */
  volume: number;
  /** Som quando a mensagem chega na conversa que já está aberta na tela. */
  activeSound: (typeof ACTIVE_CONVERSATION_SOUND)[number];
  /**
   * Notificações do sistema (navegador) com a aba em segundo plano. Só aparecem
   * se a pessoa também autorizar neste navegador (o próprio navegador pergunta).
   */
  native: boolean;
  /** Mostrar o trecho da mensagem na notificação do sistema (sem isso, só "Nova mensagem de Fulano"). */
  nativePreview: boolean;
};

export const DEFAULT_CHAT_ALERTS: ChatAlertPrefs = {
  floating: true,
  duration: 8,
  sound: true,
  volume: 40,
  activeSound: "soft",
  native: true,
  nativePreview: false,
};

/** Lê o que está gravado, ignorando valores desconhecidos (sem registro = padrão). */
export function normalizeChatAlerts(raw: unknown): ChatAlertPrefs {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (k: keyof ChatAlertPrefs) =>
    typeof r[k] === "boolean" ? (r[k] as boolean) : (DEFAULT_CHAT_ALERTS[k] as boolean);
  const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.round(r.volume) : NaN;
  return {
    floating: bool("floating"),
    duration: (ALERT_DURATIONS as readonly unknown[]).includes(r.duration)
      ? (r.duration as ChatAlertPrefs["duration"])
      : DEFAULT_CHAT_ALERTS.duration,
    sound: bool("sound"),
    volume: Number.isNaN(volume) ? DEFAULT_CHAT_ALERTS.volume : Math.min(100, Math.max(5, volume)),
    activeSound: (ACTIVE_CONVERSATION_SOUND as readonly unknown[]).includes(r.activeSound)
      ? (r.activeSound as ChatAlertPrefs["activeSound"])
      : DEFAULT_CHAT_ALERTS.activeSound,
    native: bool("native"),
    nativePreview: bool("nativePreview"),
  };
}

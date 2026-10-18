"use client";

/*
 * Som das mensagens novas, gerado no próprio navegador (Web Audio): dois
 * toques curtos e suaves, sem arquivo externo nem serviço de terceiros.
 *
 * Navegadores só liberam áudio depois de uma interação com a página (clique
 * ou tecla). O contexto de áudio é criado/retomado nessa interação — nunca
 * por fora dela — e, se o navegador continuar bloqueando, o estado fica
 * "blocked" para a interface explicar como liberar. A escolha "não tocar
 * neste aparelho" fica no armazenamento local (é do aparelho, não da conta).
 */

export type SoundState = "unsupported" | "locked" | "ready" | "blocked";
export type SoundKind = "message" | "soft";

const DEVICE_KEY = "aragonez:chat-sound";

type Listener = (state: SoundState) => void;

class SoundEngine {
  private ctx: AudioContext | null = null;
  private listeners = new Set<Listener>();
  private current: SoundState = "locked";
  private gestureBound = false;

  constructor() {
    if (typeof window !== "undefined" && !this.ctor()) this.current = "unsupported";
  }

  private ctor(): typeof AudioContext | null {
    if (typeof window === "undefined") return null;
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }

  get state() {
    return this.current;
  }

  private set(next: SoundState) {
    if (next === this.current) return;
    this.current = next;
    for (const l of this.listeners) l(next);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Preferência do aparelho: "on" (ativado), "off" (não tocar aqui) ou null (ainda não escolheu). */
  deviceChoice(): "on" | "off" | null {
    try {
      const v = localStorage.getItem(DEVICE_KEY);
      return v === "on" || v === "off" ? v : null;
    } catch {
      return null;
    }
  }

  setDeviceChoice(v: "on" | "off") {
    try {
      localStorage.setItem(DEVICE_KEY, v);
    } catch {
      // Sem armazenamento local: a escolha vale só nesta página.
    }
    for (const l of this.listeners) l(this.current);
  }

  /**
   * Com o som ligado, a próxima interação com a página (clique ou tecla)
   * libera o áudio — é a regra do navegador, não um desvio dela.
   */
  armOnGesture() {
    if (this.gestureBound || this.current === "unsupported" || typeof window === "undefined") return;
    this.gestureBound = true;
    const onGesture = () => {
      if (this.deviceChoice() === "off") return;
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      this.gestureBound = false;
      void this.unlock();
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
  }

  /** Cria/retoma o áudio. Chamar dentro de um clique ou tecla. */
  async unlock(): Promise<boolean> {
    const Ctor = this.ctor();
    if (!Ctor) {
      this.set("unsupported");
      return false;
    }
    try {
      if (!this.ctx || this.ctx.state === "closed") {
        this.ctx = new Ctor();
        this.ctx.addEventListener?.("statechange", () => {
          if (!this.ctx) return;
          if (this.ctx.state === "running") this.set("ready");
          else if (this.current === "ready") {
            // Suspenso pelo sistema (ex.: celular): volta na próxima interação.
            this.set("locked");
            this.armOnGesture();
          }
        });
      }
      if (this.ctx.state !== "running") {
        await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
      }
    } catch {
      // Recusado pelo navegador.
    }
    const ok = this.ctx?.state === "running";
    this.set(ok ? "ready" : "blocked");
    return ok;
  }

  /**
   * Toca o aviso. Devolve false se o navegador não deixou (sem interação,
   * bloqueio do site) — nesse caso nada toca e a interface oferece "Ativar som".
   */
  play(kind: SoundKind, volume: number): boolean {
    if (this.deviceChoice() === "off") return false;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") {
      if (this.current === "ready") this.set("locked");
      return false;
    }
    const v = Math.min(1, Math.max(0, volume / 100));
    // Curva de volume perceptual e teto baixo: discreto mesmo em 100%.
    const peak = v * v * 0.32 * (kind === "soft" ? 0.5 : 1);
    if (peak <= 0) return true;
    const t0 = ctx.currentTime + 0.01;
    const out = ctx.createGain();
    out.gain.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 3200;
    filter.connect(out);
    out.connect(ctx.destination);
    const notes =
      kind === "soft"
        ? [{ f: 740, at: 0, len: 0.16 }]
        : [
            { f: 660, at: 0, len: 0.14 },
            { f: 880, at: 0.11, len: 0.22 },
          ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      const start = t0 + n.at;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.len);
      osc.connect(g);
      g.connect(filter);
      osc.start(start);
      osc.stop(start + n.len + 0.02);
    }
    return true;
  }
}

let engine: SoundEngine | null = null;

export function soundEngine(): SoundEngine {
  engine ??= new SoundEngine();
  return engine;
}

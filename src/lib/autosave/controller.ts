/*
 * Controlador de salvamento automático, independente de interface.
 *
 * - Agrupa alterações rápidas (espera `debounceMs` sem novas alterações) e
 *   garante um salvamento pelo menos a cada `maxWaitMs` durante edição contínua.
 * - Um salvamento por vez: alterações feitas enquanto um salvamento está em
 *   andamento disparam outro logo depois — nunca duas requisições em paralelo,
 *   então respostas fora de ordem não sobrescrevem conteúdo mais novo.
 * - "Salvo" só depois que o servidor confirmou (o `save` resolve com ok).
 * - Falhas temporárias (sem conexão, erro do servidor) são tentadas de novo com
 *   espera crescente; conflitos e erros de validação esperam o usuário.
 */

export type AutosaveStatus = "saved" | "dirty" | "saving" | "offline" | "error" | "conflict";

export type SaveOutcome =
  | { ok: true }
  /** Sem conexão ou servidor indisponível: tenta de novo sozinho. */
  | { ok: false; kind: "offline" | "transient"; message?: string }
  /** Outra sessão salvou antes: o usuário decide. */
  | { ok: false; kind: "conflict"; message?: string }
  /** O servidor recusou o conteúdo (validação, permissão): não adianta repetir sem mudar algo. */
  | { ok: false; kind: "rejected"; message?: string };

export type AutosaveState = {
  status: AutosaveStatus;
  /** Momento da última confirmação do servidor. */
  lastSavedAt: number | null;
  message: string | null;
  /** Tentativas seguidas que falharam (para a espera crescente). */
  failures: number;
  /** Próxima tentativa automática agendada (ms epoch) quando offline/erro temporário. */
  retryAt: number | null;
};

export type AutosaveOptions = {
  /** Pode ser definido depois com `setSave` (ex.: a função muda a cada renderização). */
  save?: () => Promise<SaveOutcome>;
  debounceMs?: number;
  maxWaitMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  onChange?: (state: AutosaveState) => void;
  now?: () => number;
};

export class AutosaveController {
  private opts: Required<Omit<AutosaveOptions, "onChange" | "save">> & Pick<AutosaveOptions, "onChange">;
  private saveFn: (() => Promise<SaveOutcome>) | null;
  private state: AutosaveState = { status: "saved", lastSavedAt: null, message: null, failures: 0, retryAt: null };
  /** Incrementa a cada alteração; um salvamento só "limpa" a geração que ele levou. */
  private generation = 0;
  private savedGeneration = 0;
  private inFlight: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstDirtyAt: number | null = null;
  private disposed = false;

  constructor(options: AutosaveOptions = {}) {
    const { save, ...rest } = options;
    this.saveFn = save ?? null;
    this.opts = {
      debounceMs: rest.debounceMs ?? 1200,
      maxWaitMs: rest.maxWaitMs ?? 10_000,
      retryBaseMs: rest.retryBaseMs ?? 2_000,
      retryMaxMs: rest.retryMaxMs ?? 60_000,
      now: rest.now ?? (() => Date.now()),
      onChange: rest.onChange,
    };
  }

  setSave(fn: () => Promise<SaveOutcome>) {
    this.saveFn = fn;
  }

  setOnChange(fn: (state: AutosaveState) => void) {
    this.opts.onChange = fn;
  }

  get snapshot(): AutosaveState {
    return this.state;
  }

  /** Há algo que ainda não foi confirmado pelo servidor? */
  get pending(): boolean {
    return this.generation !== this.savedGeneration;
  }

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    this.opts.onChange?.(this.state);
  }

  /** Registra uma alteração relevante. */
  markDirty() {
    if (this.disposed) return;
    this.generation++;
    const now = this.opts.now();
    this.firstDirtyAt ??= now;
    if (this.state.status === "conflict") return; // espera a decisão do usuário
    if (this.retryTimer) return; // a nova tentativa já agendada leva tudo
    if (this.state.status !== "saving") this.set({ status: "dirty" });
    this.schedule();
  }

  private schedule() {
    if (this.retryTimer) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const elapsed = this.opts.now() - (this.firstDirtyAt ?? this.opts.now());
    const wait = Math.max(0, Math.min(this.opts.debounceMs, this.opts.maxWaitMs - elapsed));
    this.debounceTimer = setTimeout(() => void this.run(), wait);
  }

  /** Salva agora (ações importantes: exportar, sair, atalho Ctrl+S). Resolve quando o servidor respondeu. */
  async flush(): Promise<AutosaveState> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.inFlight) await this.inFlight;
    if (this.pending && this.state.status !== "conflict") await this.run();
    return this.state;
  }

  /** Tenta de novo agora (botão "tentar novamente" ou conexão de volta). */
  retry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.state.status === "conflict" || !this.pending) return;
    void this.run();
  }

  /** O usuário resolveu o conflito; `pending` diz se ainda há algo a salvar. */
  conflictResolved(opts: { pending: boolean }) {
    if (!opts.pending) this.savedGeneration = this.generation;
    this.set({ status: opts.pending ? "dirty" : "saved", message: null, failures: 0, retryAt: null });
    if (opts.pending) this.schedule();
  }

  /** Avisa que o conteúdo atual já é igual ao do servidor (ex.: recarregado ou restaurado). */
  markSaved() {
    this.savedGeneration = this.generation;
    this.firstDirtyAt = null;
    this.set({ status: "saved", lastSavedAt: this.opts.now(), message: null, failures: 0, retryAt: null });
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      // Outro salvamento já está indo: este será feito em seguida (ver o final de `execute`).
      return this.inFlight;
    }
    if (!this.pending) {
      if (this.state.status !== "conflict") this.set({ status: "saved" });
      return;
    }
    this.inFlight = this.execute().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async execute() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const generation = this.generation;
    this.set({ status: "saving", message: null });
    let outcome: SaveOutcome;
    try {
      if (!this.saveFn) throw new Error("Salvamento ainda não configurado.");
      outcome = await this.saveFn();
    } catch (err) {
      outcome = { ok: false, kind: "transient", message: err instanceof Error ? err.message : String(err) };
    }
    if (this.disposed) return;
    if (outcome.ok) {
      this.savedGeneration = generation;
      this.firstDirtyAt = this.pending ? this.opts.now() : null;
      this.set({
        status: this.pending ? "dirty" : "saved",
        lastSavedAt: this.opts.now(),
        message: null,
        failures: 0,
        retryAt: null,
      });
      // Alterações chegaram durante o salvamento: salva de novo, em sequência.
      if (this.pending) this.schedule();
      return;
    }
    if (outcome.kind === "conflict") {
      this.set({ status: "conflict", message: outcome.message ?? null, retryAt: null });
      return;
    }
    if (outcome.kind === "rejected") {
      this.set({ status: "error", message: outcome.message ?? null, retryAt: null });
      return;
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const failures = this.state.failures + 1;
    const delay = Math.min(this.opts.retryMaxMs, this.opts.retryBaseMs * 2 ** (failures - 1));
    this.set({
      status: outcome.kind === "offline" ? "offline" : "error",
      message: outcome.message ?? null,
      failures,
      retryAt: this.opts.now() + delay,
    });
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, delay);
  }

  /** Para timers (desmontagem). `resume` religa — componentes podem montar de novo. */
  dispose() {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  resume() {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.pending && this.state.status !== "conflict") this.schedule();
  }
}

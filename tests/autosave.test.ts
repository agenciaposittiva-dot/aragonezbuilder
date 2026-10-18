import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveController, type AutosaveState, type SaveOutcome } from "@/lib/autosave/controller";

/** Servidor falso: cada chamada fica pendente até o teste decidir o resultado. */
function fakeServer() {
  const calls: { resolve: (o: SaveOutcome) => void; content: number }[] = [];
  let content = 0;
  return {
    calls,
    setContent: (n: number) => (content = n),
    save: () =>
      new Promise<SaveOutcome>((resolve) => {
        calls.push({ resolve, content });
      }),
  };
}

describe("salvamento automático", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(server = fakeServer()) {
    const states: AutosaveState["status"][] = [];
    const c = new AutosaveController({
      save: server.save,
      debounceMs: 1000,
      maxWaitMs: 5000,
      retryBaseMs: 2000,
      onChange: (s) => states.push(s.status),
    });
    return { c, server, states };
  }

  it("agrupa alterações rápidas e só diz salvo depois da confirmação", async () => {
    const { c, server } = setup();
    c.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    expect(server.calls).toHaveLength(0);
    expect(c.snapshot.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(600);
    expect(server.calls).toHaveLength(1);
    expect(c.snapshot.status).toBe("saving");
    server.calls[0]!.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("saved");
    expect(c.snapshot.lastSavedAt).not.toBeNull();
  });

  it("edição contínua salva pelo menos a cada maxWait", async () => {
    const { c, server } = setup();
    for (let i = 0; i < 12; i++) {
      c.markDirty();
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(server.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("nunca faz dois salvamentos ao mesmo tempo e salva de novo o que mudou durante o envio", async () => {
    const { c, server } = setup();
    server.setContent(1);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls).toHaveLength(1);
    server.setContent(2);
    c.markDirty();
    await vi.advanceTimersByTimeAsync(3000);
    // Ainda há um salvamento em andamento: nada novo foi enviado.
    expect(server.calls).toHaveLength(1);
    server.calls[0]!.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1]!.content).toBe(2);
    server.calls[1]!.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("saved");
    expect(c.pending).toBe(false);
  });

  it("sem conexão: mantém pendente e tenta de novo com espera crescente", async () => {
    const { c, server } = setup();
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    server.calls[0]!.resolve({ ok: false, kind: "offline" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("offline");
    expect(c.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(server.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.calls).toHaveLength(2);
    server.calls[1]!.resolve({ ok: false, kind: "offline" });
    await vi.advanceTimersByTimeAsync(0);
    // Segunda falha: espera 4 s.
    await vi.advanceTimersByTimeAsync(3999);
    expect(server.calls).toHaveLength(2);
    // Conexão de volta: tenta já.
    c.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(3);
    server.calls[2]!.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("saved");
  });

  it("erro do servidor nunca aparece como salvo", async () => {
    const { c, server, states } = setup();
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    server.calls[0]!.resolve({ ok: false, kind: "transient", message: "500" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("error");
    expect(states).not.toContain("saved");
  });

  it("conflito espera a decisão do usuário e não tenta de novo sozinho", async () => {
    const { c, server } = setup();
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    server.calls[0]!.resolve({ ok: false, kind: "conflict" });
    await vi.advanceTimersByTimeAsync(0);
    expect(c.snapshot.status).toBe("conflict");
    c.markDirty();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.calls).toHaveLength(1);
    c.conflictResolved({ pending: false });
    expect(c.snapshot.status).toBe("saved");
  });

  it("flush salva imediatamente e resolve com a resposta", async () => {
    const { c, server } = setup();
    c.markDirty();
    const done = c.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls).toHaveLength(1);
    server.calls[0]!.resolve({ ok: true });
    expect((await done).status).toBe("saved");
  });

  it("recusa do servidor vira erro; nova alteração tenta de novo", async () => {
    const { c, server } = setup();
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    server.calls[0]!.resolve({ ok: false, kind: "rejected", message: "inválido" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(1);
    expect(c.snapshot.status).toBe("error");
    c.markDirty();
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.calls).toHaveLength(2);
  });
});

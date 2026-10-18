/**
 * Executa consultas em sequência. Dentro de uma transação todas as consultas
 * usam a mesma conexão, então `Promise.all` não traz paralelismo real e o
 * driver `pg` desaconselha consultas simultâneas no mesmo cliente.
 */
export async function inSequence<T extends readonly unknown[]>(
  ...thunks: { [K in keyof T]: () => PromiseLike<T[K]> }
): Promise<T> {
  const results: unknown[] = [];
  for (const thunk of thunks) results.push(await thunk());
  return results as unknown as T;
}

/** Executa as operações uma após a outra (para atualizações em lote). */
export async function eachInSequence<T>(items: readonly T[], fn: (item: T, index: number) => PromiseLike<unknown>) {
  for (let i = 0; i < items.length; i++) await fn(items[i]!, i);
}

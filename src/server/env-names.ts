/*
 * Lê uma variável pelo nome exato ou, na falta dele, pelo nome com prefixo
 * criado por integrações da Vercel (ex.: "meuprojeto_DATABASE_URL" quando um
 * prefixo é escolhido ao conectar um banco ou store). Nomes exatos têm prioridade.
 */
export function pickEnv(...names: string[]): string | undefined {
  const e = process.env;
  for (const n of names) if (e[n]) return e[n];
  const keys = Object.keys(e).sort();
  for (const n of names) {
    const key = keys.find((k) => k.endsWith(`_${n}`) && e[k]);
    if (key) return e[key];
  }
  return undefined;
}

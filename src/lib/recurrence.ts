/**
 * Datas de uma rotina (tarefa recorrente). Funções puras sobre datas ISO
 * (AAAA-MM-DD, sem fuso): todo dia, toda semana num dia da semana ou todo mês
 * num dia do mês (1 a 28, para existir em todos os meses), a cada N períodos.
 */

export type RecurrenceRule = {
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  weekday?: number | null;
  monthday?: number | null;
};

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function parse(iso: string) {
  return new Date(`${iso}T12:00:00Z`);
}
function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number) {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}
function withMonthday(year: number, month0: number, day: number) {
  return fmt(new Date(Date.UTC(year, month0, day, 12)));
}

/** Primeira data da rotina a partir de `from` (inclusive). */
export function firstOccurrence(rule: RecurrenceRule, from: string): string {
  if (rule.frequency === "daily") return from;
  if (rule.frequency === "weekly") {
    const wd = rule.weekday ?? parse(from).getUTCDay();
    const diff = (wd - parse(from).getUTCDay() + 7) % 7;
    return addDays(from, diff);
  }
  const day = rule.monthday ?? Math.min(28, parse(from).getUTCDate());
  const d = parse(from);
  const same = withMonthday(d.getUTCFullYear(), d.getUTCMonth(), day);
  return same >= from ? same : withMonthday(d.getUTCFullYear(), d.getUTCMonth() + 1, day);
}

/** Próxima data depois de uma ocorrência (`date` já é uma data da rotina). */
export function nextAfter(rule: RecurrenceRule, date: string): string {
  const n = Math.max(1, rule.interval);
  if (rule.frequency === "daily") return addDays(date, n);
  if (rule.frequency === "weekly") return addDays(date, 7 * n);
  const d = parse(date);
  return withMonthday(d.getUTCFullYear(), d.getUTCMonth() + n, rule.monthday ?? d.getUTCDate());
}

/** Primeira data da rotina estritamente depois de `today` (para pular datas que já passaram). */
export function nextAfterToday(rule: RecurrenceRule, date: string, today: string): string {
  let next = nextAfter(rule, date);
  // Limite de segurança: no máximo ~10 anos de saltos.
  for (let i = 0; next <= today && i < 4000; i++) next = nextAfter(rule, next);
  return next;
}

/** As próximas `count` datas a partir de `from` (prévia no formulário). */
export function upcoming(rule: RecurrenceRule, from: string, count = 3): string[] {
  const out = [firstOccurrence(rule, from)];
  while (out.length < count) out.push(nextAfter(rule, out[out.length - 1]!));
  return out;
}

/** Descrição curta: "Toda segunda-feira", "A cada 2 meses, no dia 5"… */
export function describeRule(rule: RecurrenceRule): string {
  const n = Math.max(1, rule.interval);
  if (rule.frequency === "daily") return n === 1 ? "Todos os dias" : `A cada ${n} dias`;
  if (rule.frequency === "weekly") {
    const wd = WEEKDAYS[rule.weekday ?? 1]!;
    const fem = (rule.weekday ?? 1) >= 1 && (rule.weekday ?? 1) <= 5;
    return n === 1 ? `${fem ? "Toda" : "Todo"} ${wd}` : `A cada ${n} semanas, ${fem ? "na" : "no"} ${wd}`;
  }
  return n === 1 ? `Todo dia ${rule.monthday ?? 1} do mês` : `A cada ${n} meses, no dia ${rule.monthday ?? 1}`;
}

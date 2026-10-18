/*
 * Datas comemorativas e comerciais brasileiras, calculadas localmente.
 * Fontes de referência (citadas em cada data):
 *  - Feriados nacionais: Lei nº 662/1949 e Lei nº 10.607/2002
 *    (https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm);
 *  - 12 de outubro: Lei nº 6.802/1980 (https://www.planalto.gov.br/ccivil_03/leis/l6802.htm);
 *  - 20 de novembro: Lei nº 14.759/2023
 *    (https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm);
 *  - Datas móveis da Páscoa: cálculo do computus gregoriano (algoritmo de Meeus/Jones/Butcher);
 *  - Datas internacionais: ONU, OMS, UNESCO e FAO; datas do varejo: calendário comercial brasileiro.
 */

export type BrDate = {
  slug: string;
  name: string;
  date: string; // AAAA-MM-DD
  description: string;
  /** Nicho mais relacionado (além de "Datas comemorativas"). */
  niche: string;
  source: string;
  url: string | null;
  /** Tema sensível (saúde, luto, causas): pede cuidado redobrado no conteúdo. */
  sensitive?: boolean;
};

const LEI_FERIADOS = {
  source: "Lei nº 10.607/2002 (feriados nacionais)",
  url: "https://www.planalto.gov.br/ccivil_03/leis/2002/l10607.htm",
};
const VAREJO = { source: "Calendário comercial brasileiro", url: null };
const POPULAR = { source: "Tradição popular brasileira", url: null };

type Fixed = Omit<BrDate, "date"> & { md: string };

const FIXED: Fixed[] = [
  {
    slug: "ano-novo",
    md: "01-01",
    name: "Confraternização Universal (Ano Novo)",
    description: "Feriado nacional de início do ano.",
    niche: "datas",
    ...LEI_FERIADOS,
  },
  {
    slug: "janeiro-branco",
    md: "01-01",
    name: "Janeiro Branco",
    description: "Campanha de conscientização sobre saúde mental ao longo de janeiro.",
    niche: "saude",
    sensitive: true,
    ...POPULAR,
  },
  {
    slug: "dia-da-mulher",
    md: "03-08",
    name: "Dia Internacional da Mulher",
    description: "Data instituída pela ONU para discutir direitos e igualdade das mulheres.",
    niche: "datas",
    source: "Organização das Nações Unidas (ONU)",
    url: "https://www.un.org/en/observances/womens-day",
  },
  {
    slug: "dia-do-consumidor",
    md: "03-15",
    name: "Dia do Consumidor",
    description: "Dia Mundial dos Direitos do Consumidor; no Brasil virou data de ofertas no varejo.",
    niche: "varejo",
    ...VAREJO,
  },
  {
    slug: "dia-da-saude",
    md: "04-07",
    name: "Dia Mundial da Saúde",
    description: "Data da Organização Mundial da Saúde.",
    niche: "saude",
    source: "Organização Mundial da Saúde (OMS)",
    url: "https://www.who.int/campaigns/world-health-day",
  },
  {
    slug: "tiradentes",
    md: "04-21",
    name: "Tiradentes",
    description: "Feriado nacional.",
    niche: "datas",
    ...LEI_FERIADOS,
  },
  {
    slug: "dia-do-livro",
    md: "04-23",
    name: "Dia Mundial do Livro",
    description: "Data da UNESCO dedicada ao livro e aos direitos autorais.",
    niche: "educacao",
    source: "UNESCO",
    url: "https://www.unesco.org/en/days/book-and-copyright",
  },
  {
    slug: "dia-do-trabalhador",
    md: "05-01",
    name: "Dia do Trabalhador",
    description: "Feriado nacional.",
    niche: "datas",
    ...LEI_FERIADOS,
  },
  {
    slug: "meio-ambiente",
    md: "06-05",
    name: "Dia Mundial do Meio Ambiente",
    description: "Data da ONU sobre preservação ambiental.",
    niche: "datas",
    source: "Organização das Nações Unidas (ONU)",
    url: "https://www.un.org/en/observances/environment-day",
  },
  {
    slug: "dia-dos-namorados",
    md: "06-12",
    name: "Dia dos Namorados",
    description: "Uma das principais datas do varejo brasileiro.",
    niche: "varejo",
    ...VAREJO,
  },
  {
    slug: "sao-joao",
    md: "06-24",
    name: "São João (Festas Juninas)",
    description: "Ponto alto das festas juninas, especialmente no Nordeste.",
    niche: "alimentacao",
    ...POPULAR,
  },
  {
    slug: "dia-do-amigo",
    md: "07-20",
    name: "Dia do Amigo",
    description: "Data popular de celebração da amizade.",
    niche: "entretenimento",
    ...POPULAR,
  },
  {
    slug: "dia-dos-avos",
    md: "07-26",
    name: "Dia dos Avós",
    description: "Data popular dedicada aos avós.",
    niche: "datas",
    ...POPULAR,
  },
  {
    slug: "dia-do-estudante",
    md: "08-11",
    name: "Dia do Estudante",
    description: "Data comemorativa dos estudantes no Brasil.",
    niche: "educacao",
    ...POPULAR,
  },
  {
    slug: "setembro-amarelo",
    md: "09-01",
    name: "Setembro Amarelo",
    description: "Campanha de prevenção ao suicídio ao longo de setembro.",
    niche: "saude",
    sensitive: true,
    ...POPULAR,
  },
  {
    slug: "independencia",
    md: "09-07",
    name: "Independência do Brasil",
    description: "Feriado nacional.",
    niche: "datas",
    ...LEI_FERIADOS,
  },
  {
    slug: "dia-do-cliente",
    md: "09-15",
    name: "Dia do Cliente",
    description: "Data do varejo e de serviços para relacionamento com clientes.",
    niche: "varejo",
    ...VAREJO,
  },
  {
    slug: "outubro-rosa",
    md: "10-01",
    name: "Outubro Rosa",
    description: "Campanha de conscientização sobre o câncer de mama ao longo de outubro.",
    niche: "saude",
    sensitive: true,
    ...POPULAR,
  },
  {
    slug: "dia-das-criancas",
    md: "10-12",
    name: "Nossa Senhora Aparecida e Dia das Crianças",
    description: "Feriado nacional e uma das principais datas do varejo.",
    niche: "varejo",
    source: "Lei nº 6.802/1980",
    url: "https://www.planalto.gov.br/ccivil_03/leis/l6802.htm",
  },
  {
    slug: "dia-do-professor",
    md: "10-15",
    name: "Dia do Professor",
    description: "Data comemorativa dos professores no Brasil.",
    niche: "educacao",
    ...POPULAR,
  },
  {
    slug: "dia-da-alimentacao",
    md: "10-16",
    name: "Dia Mundial da Alimentação",
    description: "Data da FAO sobre alimentação e combate à fome.",
    niche: "alimentacao",
    source: "FAO/ONU",
    url: "https://www.fao.org/world-food-day",
  },
  {
    slug: "halloween",
    md: "10-31",
    name: "Halloween / Dia do Saci",
    description: "Data popular de fantasias; no Brasil também celebrada como Dia do Saci.",
    niche: "entretenimento",
    ...POPULAR,
  },
  {
    slug: "novembro-azul",
    md: "11-01",
    name: "Novembro Azul",
    description: "Campanha de saúde do homem e prevenção do câncer de próstata ao longo de novembro.",
    niche: "saude",
    sensitive: true,
    ...POPULAR,
  },
  {
    slug: "finados",
    md: "11-02",
    name: "Finados",
    description: "Feriado nacional de memória aos mortos.",
    niche: "datas",
    sensitive: true,
    ...LEI_FERIADOS,
  },
  {
    slug: "proclamacao-republica",
    md: "11-15",
    name: "Proclamação da República",
    description: "Feriado nacional.",
    niche: "datas",
    ...LEI_FERIADOS,
  },
  {
    slug: "consciencia-negra",
    md: "11-20",
    name: "Dia Nacional de Zumbi e da Consciência Negra",
    description: "Feriado nacional desde 2024.",
    niche: "datas",
    source: "Lei nº 14.759/2023",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm",
  },
  {
    slug: "natal",
    md: "12-25",
    name: "Natal",
    description: "Feriado nacional e principal data do varejo.",
    niche: "varejo",
    ...LEI_FERIADOS,
  },
  {
    slug: "reveillon",
    md: "12-31",
    name: "Véspera de Ano Novo",
    description: "Data de festas e de planejamento do próximo ano.",
    niche: "datas",
    ...VAREJO,
  },
];

/** Domingo de Páscoa (calendário gregoriano). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** N-ésimo dia da semana (0 = domingo) de um mês. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}

export function brDatesForYear(year: number): BrDate[] {
  const out: BrDate[] = FIXED.map(({ md, ...rest }) => ({ ...rest, date: `${year}-${md}` }));
  const e = easter(year);
  const computus = { source: "Data móvel calculada a partir da Páscoa (computus gregoriano)", url: null };
  out.push(
    {
      slug: "carnaval",
      name: "Carnaval",
      date: iso(addDays(e, -47)),
      description: "Terça-feira de Carnaval (ponto facultativo nacional; feriado em alguns estados e cidades).",
      niche: "entretenimento",
      ...computus,
    },
    {
      slug: "sexta-feira-santa",
      name: "Sexta-feira Santa",
      date: iso(addDays(e, -2)),
      description: "Feriado nacional religioso.",
      niche: "datas",
      ...LEI_FERIADOS,
    },
    {
      slug: "pascoa",
      name: "Páscoa",
      date: iso(e),
      description: "Data religiosa e forte data do varejo (chocolates).",
      niche: "varejo",
      ...computus,
    },
    {
      slug: "corpus-christi",
      name: "Corpus Christi",
      date: iso(addDays(e, 60)),
      description: "Ponto facultativo nacional; feriado em muitas cidades.",
      niche: "datas",
      ...computus,
    },
    {
      slug: "dia-das-maes",
      name: "Dia das Mães",
      date: iso(nthWeekday(year, 5, 0, 2)),
      description: "Segundo domingo de maio; segunda maior data do varejo brasileiro.",
      niche: "varejo",
      ...VAREJO,
    },
    {
      slug: "dia-dos-pais",
      name: "Dia dos Pais",
      date: iso(nthWeekday(year, 8, 0, 2)),
      description: "Segundo domingo de agosto.",
      niche: "varejo",
      ...VAREJO,
    },
  );
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  out.push(
    {
      slug: "black-friday",
      name: "Black Friday",
      date: iso(addDays(thanksgiving, 1)),
      description: "Sexta-feira após a quarta quinta-feira de novembro; maior data de promoções do varejo.",
      niche: "varejo",
      ...VAREJO,
    },
    {
      slug: "cyber-monday",
      name: "Cyber Monday",
      date: iso(addDays(thanksgiving, 4)),
      description: "Segunda-feira após a Black Friday, focada no comércio eletrônico.",
      niche: "varejo",
      ...VAREJO,
    },
  );
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Datas entre hoje-2 e hoje+dias (vira o ano quando preciso). */
export function upcomingBrDates(now: Date, days = 60): BrDate[] {
  const from = iso(addDays(now, -2));
  const to = iso(addDays(now, days));
  const year = now.getUTCFullYear();
  return [...brDatesForYear(year), ...brDatesForYear(year + 1)].filter((d) => d.date >= from && d.date <= to);
}

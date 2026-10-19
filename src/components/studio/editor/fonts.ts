/** Fontes oferecidas no editor (Google Fonts, licenças abertas) além das fontes da marca. */
export const BASE_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "DM Sans",
  "Manrope",
  "Space Grotesk",
  "Roboto",
  "Open Sans",
  "Lato",
  "Nunito",
  "Work Sans",
  "Raleway",
  "Oswald",
  "Anton",
  "Bebas Neue",
  "Archivo Black",
  "Playfair Display",
  "Merriweather",
  "Lora",
  "DM Serif Display",
  "Caveat",
  "Arial",
  "Georgia",
];
const SYSTEM_FONTS = new Set(["Arial", "Georgia", "Helvetica", "Times New Roman", "Verdana", "sans-serif", "serif"]);

const loading = new Map<string, Promise<void>>();
/** Carga completa (sem o limite de espera de `ensureFont`). */
const settled = new Map<string, Promise<unknown>>();
/** Pesos além de 400/700 (ex.: fino 100), carregados quando algum texto usa. */
const faces = new Map<string, Promise<void>>();

/** Todos os pesos no CSS (o Google devolve só os que a família tem); os arquivos baixam sob demanda. */
const AXES = `ital,wght@${[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => `0,${w}`).join(";")};1,400;1,700`;
const wait = (p: Promise<unknown>) => Promise.race([p, new Promise((r) => setTimeout(r, 6000))]);

function ensureWeight(family: string, weight: number): Promise<void> {
  const key = `${family}|${weight}`;
  const cached = faces.get(key);
  if (cached) return cached;
  const p = wait(stylesheet(family).then(() => document.fonts.load(`${weight} 32px "${family}"`)))
    .then(() => undefined)
    .catch(() => undefined);
  faces.set(key, p);
  return p;
}

/**
 * Carrega a fonte antes de desenhar ou exportar (o texto é medido com a fonte
 * real). Fonte indisponível: o navegador usa a alternativa, sem travar.
 */
export function ensureFont(family: string, weights: number[] = []): Promise<void> {
  if (!family || SYSTEM_FONTS.has(family) || typeof document === "undefined") return Promise.resolve();
  const extra = [...new Set(weights)].filter((w) => w !== 400 && w !== 700);
  const base = loadFamily(family);
  if (!extra.length) return base;
  return base.then(() => Promise.all(extra.map((w) => ensureWeight(family, w)))).then(() => undefined);
}

/**
 * Folha de estilo da família no Google Fonts, já carregada. Sem esperar por ela,
 * `document.fonts.load` não conhece as faces ainda e responde "carregada" na
 * hora — o texto seria medido com a fonte alternativa (quebras de linha erradas).
 */
const sheets = new Map<string, Promise<void>>();
const sheetReady = new Set<string>();
function stylesheet(family: string): Promise<void> {
  const cached = sheets.get(family);
  if (cached) return cached;
  const id = `gf-${family.replace(/\s+/g, "-")}`;
  let link = document.getElementById(id) as HTMLLinkElement | null;
  const p = new Promise<void>((resolve) => {
    if (link?.sheet) {
      resolve();
      return;
    }
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:${AXES}&display=swap`;
      document.head.appendChild(link);
    }
    // Fonte fora do Google (ex.: da marca): erro na folha, segue com as faces que existirem.
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
  }).then(() => {
    sheetReady.add(family);
  });
  sheets.set(family, p);
  return p;
}

function loadFamily(family: string): Promise<void> {
  const cached = loading.get(family);
  if (cached) return cached;
  const full = stylesheet(family).then(() =>
    Promise.all([
      document.fonts.load(`400 32px "${family}"`),
      document.fonts.load(`700 32px "${family}"`),
      document.fonts.load(`italic 400 32px "${family}"`),
    ]),
  );
  settled.set(
    family,
    full.catch(() => undefined),
  );
  // Fonte indisponível ou lenta: o navegador usa a alternativa, sem travar (o editor mede de novo quando chegar).
  const p = wait(full)
    .then(() => undefined)
    .catch(() => undefined);
  loading.set(family, p);
  return p;
}

/** `weights`: pesos usados por família (ver `fontWeightsOf`), para carregar os além de 400/700. */
export async function ensureFonts(families: string[], weights: Record<string, number[]> = {}) {
  await Promise.all([...new Set(families)].map((f) => ensureFont(f, weights[f])));
  if (typeof document !== "undefined") await document.fonts.ready.catch(() => undefined);
}

/**
 * Fonte que ainda não terminou de carregar (passou do tempo de espera): avisa
 * quando terminar, para o editor medir e desenhar os textos de novo — senão o
 * texto fica com as larguras da fonte alternativa (letras espaçadas/sobrepostas).
 */
export function whenFontLoads(family: string, done: () => void) {
  if (!family || SYSTEM_FONTS.has(family) || typeof document === "undefined") return;
  // Antes da folha de estilo chegar, `check` responde "carregada" (não conhece as faces): espera.
  const ready =
    sheetReady.has(family) &&
    document.fonts.check(`400 32px "${family}"`) &&
    document.fonts.check(`700 32px "${family}"`);
  if (ready) return;
  void (settled.get(family) ?? ensureFont(family)).then(() => {
    if (document.fonts.check(`400 32px "${family}"`)) done();
  });
}

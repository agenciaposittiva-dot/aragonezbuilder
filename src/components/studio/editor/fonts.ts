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

/**
 * Carrega a fonte antes de desenhar ou exportar (o texto é medido com a fonte
 * real). Fonte indisponível: o navegador usa a alternativa, sem travar.
 */
export function ensureFont(family: string): Promise<void> {
  if (!family || SYSTEM_FONTS.has(family) || typeof document === "undefined") return Promise.resolve();
  const cached = loading.get(family);
  if (cached) return cached;
  const p = (async () => {
    const id = `gf-${family.replace(/\s+/g, "-")}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:ital,wght@0,400;0,700;1,400&display=swap`;
      document.head.appendChild(link);
    }
    try {
      await Promise.race([
        Promise.all([
          document.fonts.load(`400 32px "${family}"`),
          document.fonts.load(`700 32px "${family}"`),
          document.fonts.load(`italic 400 32px "${family}"`),
        ]),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    } catch {
      /* fonte indisponível: o navegador usa a alternativa */
    }
  })();
  loading.set(family, p);
  return p;
}

export async function ensureFonts(families: string[]) {
  await Promise.all([...new Set(families)].map(ensureFont));
  if (typeof document !== "undefined") await document.fonts.ready.catch(() => undefined);
}

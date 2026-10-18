import { z } from "zod";

/*
 * Personalização do portal do cliente. Tudo aqui é DADO validado: textos são
 * exibidos como texto (nunca HTML), cores são hexadecimais, links só aceitam
 * http(s), mailto, tel ou caminhos internos do portal, e imagens são
 * referências a arquivos do próprio cliente (verificadas no servidor).
 * Campos vazios caem no padrão elegante da agência.
 */

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB")
  .transform((v) => v.toLowerCase());
const optHex = z
  .union([hex, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const fileRef = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/** Links seguros: http(s), mailto, tel ou caminho do portal ("/requests/new"). */
export const SAFE_URL_RE = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[+\d][\d\s()-]*|\/[a-z0-9/_-]*)$/i;
const safeUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => SAFE_URL_RE.test(v),
    "Use um link https://, mailto:, tel: ou um caminho do portal (ex.: /requests/new)",
  );

const link = z.object({ label: z.string().trim().min(1, "Informe o texto").max(60), url: safeUrl });

export const BANNER_ALIGN = ["left", "center", "right"] as const;
export const BANNER_VALIGN = ["top", "center", "bottom"] as const;
export const BANNER_OVERLAY = ["none", "light", "dark", "gradient"] as const;
export const BANNER_HEIGHT = { min: 180, max: 560, default: 320 } as const;

export const PORTAL_SECTIONS = {
  banner: "Banner de boas-vindas",
  stats: "Indicadores",
  approvals: "Aprovações pendentes",
  requests: "Solicitações em andamento",
  projects: "Projetos ativos",
  deadlines: "Próximos prazos",
  deliveries: "Entregas recentes",
  files: "Arquivos finais",
  notifications: "Notificações",
  links: "Links úteis",
  contact: "Contato",
} as const;
export type PortalSection = keyof typeof PORTAL_SECTIONS;

const sections = z
  .object(
    Object.fromEntries(Object.keys(PORTAL_SECTIONS).map((k) => [k, z.boolean().default(true)])) as Record<
      PortalSection,
      z.ZodDefault<z.ZodBoolean>
    >,
  )
  .prefault({});

export const portalSettingsSchema = z.object({
  /** Nome exibido no portal (padrão: nome do cliente). */
  displayName: text(80),
  /** Logotipo principal (para fundos claros). Sem ele, usa o logotipo do cliente em Marca. */
  logoFileId: fileRef,
  /** Logotipo alternativo para fundos escuros (banner, login). */
  logoAltFileId: fileRef,
  /** Ícone da aba do navegador. */
  faviconFileId: fileRef,
  colors: z
    .object({
      primary: optHex,
      secondary: optHex,
      accent: optHex,
      background: optHex,
      text: optHex,
    })
    .prefault({}),
  welcomeTitle: text(120),
  welcomeText: text(600),
  login: z
    .object({
      backgroundFileId: fileRef,
      title: text(120),
      message: text(400),
    })
    .prefault({}),
  banner: z
    .object({
      enabled: z.boolean().default(true),
      imageFileId: fileRef,
      showLogo: z.boolean().default(true),
      title: text(120),
      subtitle: text(300),
      buttonLabel: text(40),
      buttonUrl: z
        .union([safeUrl, z.literal(""), z.null()])
        .optional()
        .transform((v) => (v ? v : null)),
      align: z.enum(BANNER_ALIGN).default("left"),
      verticalAlign: z.enum(BANNER_VALIGN).default("center"),
      /** Ponto de foco da imagem (object-position), em %. */
      focalX: z.coerce.number().min(0).max(100).default(50),
      focalY: z.coerce.number().min(0).max(100).default(50),
      height: z.coerce.number().int().min(BANNER_HEIGHT.min).max(BANNER_HEIGHT.max).default(BANNER_HEIGHT.default),
      overlay: z.enum(BANNER_OVERLAY).default("gradient"),
      overlayOpacity: z.coerce.number().int().min(0).max(90).default(55),
    })
    .prefault({}),
  links: z.array(link).max(8, "No máximo 8 links").default([]),
  actions: z
    .array(link.extend({ style: z.enum(["primary", "secondary"]).default("primary") }))
    .max(3, "No máximo 3 botões")
    .default([]),
  contact: z
    .object({
      name: text(80),
      email: z
        .union([z.email("E-mail inválido"), z.literal(""), z.null()])
        .optional()
        .transform((v) => (v ? v : null)),
      phone: text(40),
      whatsapp: text(40),
      hours: text(120),
      note: text(300),
    })
    .prefault({}),
  sections,
});

export type PortalSettings = z.output<typeof portalSettingsSchema>;
export type PortalSettingsInput = z.input<typeof portalSettingsSchema>;

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = portalSettingsSchema.parse({});

/** Lê configurações guardadas sem nunca quebrar a página (dados inválidos → padrão). */
export function parsePortalSettings(raw: unknown): PortalSettings {
  const parsed = portalSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_PORTAL_SETTINGS;
}

/** Arquivos referenciados pelas configurações (para validação e entrega). */
export const PORTAL_ASSET_KEYS = ["logo", "logoAlt", "favicon", "loginBackground", "banner"] as const;
export type PortalAssetKey = (typeof PORTAL_ASSET_KEYS)[number];

export function assetFileId(s: PortalSettings, key: PortalAssetKey): string | null {
  switch (key) {
    case "logo":
      return s.logoFileId;
    case "logoAlt":
      return s.logoAltFileId;
    case "favicon":
      return s.faviconFileId;
    case "loginBackground":
      return s.login.backgroundFileId;
    case "banner":
      return s.banner.imageFileId;
  }
}

/** Itens exibidos sem login (página de entrada do portal). */
export const PUBLIC_ASSET_KEYS: PortalAssetKey[] = ["logo", "logoAlt", "favicon", "loginBackground"];

/* ------------------------------------------------------------------ */
/* Contraste (WCAG)                                                    */
/* ------------------------------------------------------------------ */

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Cor de texto legível sobre um fundo (preto suave ou branco). */
export function readableOn(bg: string): string {
  return contrastRatio(bg, "#161513") >= contrastRatio(bg, "#ffffff") ? "#161513" : "#ffffff";
}

export const DEFAULT_LIGHT = { background: "#f6f5f1", text: "#161513" };

/** Problemas de contraste (texto x fundo exige 4,5:1, padrão AA). */
export function contrastIssues(s: PortalSettings): { field: string; message: string }[] {
  const bg = s.colors.background ?? DEFAULT_LIGHT.background;
  const fg = s.colors.text ?? DEFAULT_LIGHT.text;
  const out: { field: string; message: string }[] = [];
  const ratio = contrastRatio(bg, fg);
  if (ratio < 4.5) {
    out.push({
      field: "colors.text",
      message: `O contraste entre o texto e o fundo é ${ratio.toFixed(1)}:1; o mínimo legível é 4,5:1.`,
    });
  }
  return out;
}

import { z } from "zod";
import { portalSettingsSchema } from "@/lib/portal-settings";
import { brandProfileInput, clientInput } from "./clients";
import { optionalText, priorityEnum, requiredText } from "./common";
import { FILE_CATEGORIES } from "./files";

/*
 * Pacote de cliente: um .zip com `manifest.json` na raiz (ou numa única pasta)
 * e os arquivos referenciados por caminho. Um só envio cria o cliente, a marca,
 * a biblioteca, os projetos com demandas e a personalização do portal. O
 * formato é documentado em docs/PACOTE-DE-CLIENTE.md.
 */

export const PACKAGE_FORMAT = "aragonez-client-package";
export const PACKAGE_VERSION = 1;

export const PACKAGE_LIMITS = {
  files: 100,
  projects: 20,
  tasksPerProject: 200,
  /** Tamanho do manifest.json. */
  manifestBytes: 1_000_000,
  /** Itens dentro do zip (depois de ignorar pastas e lixo de sistema). */
  entries: 300,
  /** Cada item descompactado. */
  entryBytes: 50 * 1024 * 1024,
  /** Soma dos itens descompactados. */
  totalBytes: 150 * 1024 * 1024,
} as const;

/** Caminho relativo dentro do zip: sem barra inicial, sem "\" e sem segmentos "..". */
const SAFE_PATH = /^(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0-\x1f]+$/;
const entryPath = z.string().trim().min(1).max(300).regex(SAFE_PATH, "Caminho inválido no pacote");

export const packageFileSchema = z.object({
  path: entryPath,
  category: z.enum(FILE_CATEGORIES).default("general"),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  /** Define este arquivo (imagem) como logotipo do cliente. Só um por pacote. */
  logo: z.boolean().default(false),
  note: optionalText(500),
});

export const packageTaskSchema = z.object({
  title: requiredText("o título", 300),
  description: optionalText(20000),
  priority: priorityEnum.default("medium"),
});

export const packageProjectSchema = z.object({
  name: requiredText("o nome", 160),
  description: optionalText(10000),
  objective: optionalText(3000),
  priority: priorityEnum.default("medium"),
  tasks: z.array(packageTaskSchema).max(PACKAGE_LIMITS.tasksPerProject).default([]),
});

const fileRef = z
  .union([entryPath, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

export const packagePortalSchema = z.object({
  /** Mesmo formato da personalização do portal; as imagens vêm de `files`, por caminho. */
  settings: portalSettingsSchema.prefault({}),
  files: z
    .object({
      logo: fileRef,
      logoAlt: fileRef,
      favicon: fileRef,
      loginBackground: fileRef,
      banner: fileRef,
    })
    .prefault({}),
  access: z
    .object({
      /** Sem valor, mantém o endereço gerado a partir do nome. */
      slug: z
        .union([z.string().trim().toLowerCase().min(2).max(48), z.literal(""), z.null()])
        .optional()
        .transform((v) => (v ? v : null)),
      loginEnabled: z.boolean().default(true),
      allowGuestInvites: z.boolean().default(false),
    })
    .optional(),
  /** Publica a personalização ao importar (senão fica como rascunho). */
  publish: z.boolean().default(true),
});

export const clientPackageSchema = z
  .object({
    format: z.literal(PACKAGE_FORMAT, { error: `Informe "format": "${PACKAGE_FORMAT}"` }),
    version: z.literal(PACKAGE_VERSION, { error: `Versão do pacote não suportada (use ${PACKAGE_VERSION})` }),
    client: clientInput.omit({ categoryId: true, leadMembershipId: true }),
    brand: brandProfileInput.omit({ clientId: true }).optional(),
    files: z.array(packageFileSchema).max(PACKAGE_LIMITS.files).default([]),
    projects: z.array(packageProjectSchema).max(PACKAGE_LIMITS.projects).default([]),
    portal: packagePortalSchema.optional(),
  })
  .superRefine((pkg, ctx) => {
    const paths = new Set<string>();
    pkg.files.forEach((f, i) => {
      if (paths.has(f.path)) ctx.addIssue({ code: "custom", path: ["files", i, "path"], message: `Caminho repetido: ${f.path}` });
      paths.add(f.path);
    });
    if (pkg.files.filter((f) => f.logo).length > 1) {
      ctx.addIssue({ code: "custom", path: ["files"], message: "Só um arquivo pode ser o logotipo do cliente." });
    }
    if (pkg.portal) {
      for (const [key, path] of Object.entries(pkg.portal.files)) {
        if (path && !paths.has(path)) {
          ctx.addIssue({
            code: "custom",
            path: ["portal", "files", key],
            message: `A imagem ${path} do portal precisa estar na lista "files" do pacote.`,
          });
        }
      }
    }
  });

export type ClientPackage = z.output<typeof clientPackageSchema>;
export type ClientPackageInput = z.input<typeof clientPackageSchema>;

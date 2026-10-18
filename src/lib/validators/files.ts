import { z } from "zod";
import { optionalText, optionalUuid, requiredText, uuid } from "./common";

export const FILE_CATEGORIES = [
  "general",
  "deliverable",
  "reference",
  "document",
  "brand_logo",
  "brand_asset",
  "brand_guideline",
  "template",
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const FILE_CATEGORY_LABEL: Record<FileCategory, string> = {
  general: "Geral",
  deliverable: "Entrega",
  reference: "Referência",
  document: "Documento",
  brand_logo: "Logotipo",
  brand_asset: "Material de marca",
  brand_guideline: "Diretriz de marca",
  template: "Template",
};

export const FILE_STATUSES = ["draft", "in_review", "changes_requested", "approved", "final", "archived"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  changes_requested: "Ajustes solicitados",
  approved: "Aprovado",
  final: "Final",
  archived: "Arquivado",
};

const tag = z.string().trim().toLowerCase().min(1).max(40);

export const uploadMetaInput = z.object({
  fileId: optionalUuid,
  clientId: optionalUuid,
  projectId: optionalUuid,
  taskId: optionalUuid,
  requestId: optionalUuid,
  folderId: optionalUuid,
  category: z.enum(FILE_CATEGORIES).default("general"),
  tags: z.array(tag).max(20).default([]),
  note: optionalText(500),
  /** Origem da versão: envio manual, exportação do editor ou geração por IA. */
  source: z.enum(["upload", "editor", "ai"]).default("upload"),
});
export type UploadMeta = z.input<typeof uploadMetaInput>;

export const fileUpdateInput = z.object({
  id: uuid,
  name: requiredText("o nome", 200),
  description: optionalText(2000),
  category: z.enum(FILE_CATEGORIES),
  tags: z.array(tag).max(20).default([]),
  status: z.enum(FILE_STATUSES),
  folderId: optionalUuid,
});

export const fileListParams = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  requestId: z.uuid().optional(),
  folderId: z.union([z.uuid(), z.literal("root")]).optional(),
  category: z.enum(FILE_CATEGORIES).optional(),
  categories: z.array(z.enum(FILE_CATEGORIES)).optional(),
  status: z.enum(FILE_STATUSES).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
  favorites: z.coerce.boolean().optional(),
  final: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(6).max(200).default(48),
});
export type FileListParams = z.input<typeof fileListParams>;

export const folderInput = z.object({
  id: optionalUuid,
  name: requiredText("o nome da pasta", 80),
  parentId: optionalUuid,
  clientId: optionalUuid,
  projectId: optionalUuid,
});

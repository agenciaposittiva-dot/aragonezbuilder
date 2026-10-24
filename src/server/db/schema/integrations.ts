import { bigint, index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, timestamps, tstz } from "./_helpers";
import { user } from "./auth";
import { organizations } from "./core";

/*
 * Integrações por pessoa (cada conexão pertence a quem autorizou, dentro da
 * organização). Tokens sempre criptografados (src/server/crypto.ts); nunca
 * vão ao navegador nem a logs.
 */

export const googleDriveStatus = pgEnum("google_drive_status", ["connected", "reauth_required", "error"]);

/** Conta Google conectada pela pessoa para usar o Drive dela como destino/origem de arquivos. */
export const googleDriveConnections = pgTable(
  "google_drive_connections",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** `sub` da conta Google (estável); o e-mail é só para exibição. */
    googleAccountId: text().notNull(),
    email: text(),
    accessTokenEnc: text().notNull(),
    refreshTokenEnc: text(),
    accessTokenExpiresAt: tstz(),
    scopes: text().array().notNull().default([]),
    status: googleDriveStatus().notNull().default("connected"),
    lastError: text(),
    lastCheckedAt: tstz(),
    /** Pasta raiz criada pela plataforma ("Aragonez Builder") na conta da pessoa. */
    rootFolderId: text(),
    /** Pasta padrão escolhida (dentro das pastas que a plataforma pode ver). */
    defaultFolderId: text(),
    defaultFolderName: text(),
    /** Organização automática das subpastas: none | client | client_project | client_project_year. */
    organizeBy: text().notNull().default("client_project"),
    /** Destino preferido dos novos arquivos: platform | drive. */
    preferredDestination: text().notNull().default("platform"),
    ...timestamps,
  },
  (t) => [uniqueIndex("google_drive_connections_scope").on(t.organizationId, t.userId)],
);

/**
 * Arquivo que passou pelo Drive: original no Drive (id, nome, link) e, quando
 * existe, a cópia/origem na plataforma (fileId/versionId). Separa claramente
 * o que está em cada lado e o estado da operação.
 */
export const googleDriveFiles = pgTable(
  "google_drive_files",
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid()
      .notNull()
      .references(() => googleDriveConnections.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** export = enviado da plataforma para o Drive; import = trazido do Drive para a plataforma. */
    direction: text().notNull(),
    driveFileId: text().notNull(),
    driveFolderId: text(),
    name: text().notNull(),
    mimeType: text(),
    sizeBytes: bigint({ mode: "number" }),
    webViewLink: text(),
    /** Arquivo/versão correspondente na plataforma (quando houver). */
    fileId: uuid(),
    fileVersionId: uuid(),
    /** ok | failed (com lastError). */
    status: text().notNull().default("ok"),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.userId),
    index().on(t.organizationId, t.fileId),
    uniqueIndex("google_drive_files_version").on(t.organizationId, t.direction, t.fileVersionId, t.driveFileId),
  ],
);

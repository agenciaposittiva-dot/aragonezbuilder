import { customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/*
 * Conteúdo dos arquivos quando STORAGE_DRIVER=database (padrão na Vercel sem
 * bucket S3). Sem organization_id: o acesso passa sempre pelos serviços de
 * arquivos, que verificam a permissão antes de ler a chave.
 */
export const storageObjects = pgTable("storage_objects", {
  key: text().primaryKey(),
  data: bytea().notNull(),
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

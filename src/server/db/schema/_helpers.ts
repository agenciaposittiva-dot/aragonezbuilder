import { timestamp, uuid } from "drizzle-orm/pg-core";

/** Chave primária UUID gerada pelo banco. */
export const id = () => uuid().primaryKey().defaultRandom();

/** Colunas de data de criação/atualização. */
export const timestamps = {
  createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const createdAt = () => timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow();

export const tstz = () => timestamp({ withTimezone: true, mode: "date" });

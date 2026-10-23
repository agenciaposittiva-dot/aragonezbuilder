import { afterEach, describe, expect, it } from "vitest";
import { databaseOwnerUrl, databaseUrl, normalizeSslMode } from "@/server/db-url";

/*
 * O driver `pg` 8 trata sslmode=prefer|require|verify-ca como verify-full e
 * emite um aviso de segurança a cada build. A aplicação grava o modo explícito
 * para manter o mesmo comportamento sem o aviso.
 */
describe("normalizeSslMode", () => {
  it("troca os modos tratados como verify-full pelo nome explícito", () => {
    expect(normalizeSslMode("postgres://u:p@h/db?sslmode=require")).toBe("postgres://u:p@h/db?sslmode=verify-full");
    expect(normalizeSslMode("postgres://u:p@h/db?a=1&sslmode=prefer&b=2")).toBe(
      "postgres://u:p@h/db?a=1&sslmode=verify-full&b=2",
    );
    expect(normalizeSslMode("postgres://u:p@h/db?SSLMODE=verify-ca")).toBe("postgres://u:p@h/db?SSLMODE=verify-full");
  });

  it("não mexe em verify-full, disable, URLs sem sslmode, com uselibpqcompat ou vazias", () => {
    for (const url of [
      "postgres://u:p@h/db?sslmode=verify-full",
      "postgres://u:p@h/db?sslmode=disable",
      "postgres://u:p@h/db",
      "postgres://u:p@h/db?uselibpqcompat=true&sslmode=require",
      "postgres://u:p%40ss@h:5432/db?options=project%3Dx&sslmode=requirement",
      "",
    ]) {
      expect(normalizeSslMode(url)).toBe(url);
    }
    expect(normalizeSslMode(undefined)).toBeUndefined();
  });
});

describe("databaseUrl / databaseOwnerUrl", () => {
  const keys = ["DATABASE_URL", "DATABASE_OWNER_URL", "DATABASE_URL_UNPOOLED"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("normalizam o sslmode das variáveis de ambiente", () => {
    process.env.DATABASE_URL = "postgres://app:p@h/db?sslmode=require";
    process.env.DATABASE_OWNER_URL = "postgres://owner:p@h/db?sslmode=require";
    expect(databaseUrl()).toBe("postgres://app:p@h/db?sslmode=verify-full");
    expect(databaseOwnerUrl()).toBe("postgres://owner:p@h/db?sslmode=verify-full");

    delete process.env.DATABASE_OWNER_URL;
    process.env.DATABASE_URL_UNPOOLED = "postgres://owner:p@h/db?sslmode=verify-ca";
    expect(databaseOwnerUrl()).toBe("postgres://owner:p@h/db?sslmode=verify-full");
  });
});

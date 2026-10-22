import { describe, expect, it } from "vitest";
import { DEFAULT_PORTAL_SETTINGS, parsePortalSettings, portalSettingsSchema } from "@/lib/portal-settings";

describe("login do portal: layout e política de privacidade", () => {
  it("padrão é o cartão com arte, sem link de privacidade", () => {
    expect(DEFAULT_PORTAL_SETTINGS.login.layout).toBe("card");
    expect(DEFAULT_PORTAL_SETTINGS.login.privacyUrl).toBeNull();
  });

  it("configurações antigas (sem os campos novos) continuam válidas", () => {
    const old = parsePortalSettings({ login: { title: "Olá", message: "Bem-vindo", backgroundFileId: null } });
    expect(old.login).toMatchObject({ title: "Olá", layout: "card", privacyUrl: null });
  });

  it("duas colunas continua disponível", () => {
    expect(portalSettingsSchema.parse({ login: { layout: "split" } }).login.layout).toBe("split");
    expect(portalSettingsSchema.safeParse({ login: { layout: "outro" } }).success).toBe(false);
  });

  it("link de privacidade segue a regra dos links do portal (sem javascript: nem data:)", () => {
    const ok = portalSettingsSchema.parse({ login: { privacyUrl: "https://exemplo.com/privacidade" } });
    expect(ok.login.privacyUrl).toBe("https://exemplo.com/privacidade");
    expect(portalSettingsSchema.parse({ login: { privacyUrl: "" } }).login.privacyUrl).toBeNull();
    for (const bad of ["javascript:alert(1)", "data:text/html,oi", "//outro-site.com"]) {
      expect(portalSettingsSchema.safeParse({ login: { privacyUrl: bad } }).success).toBe(false);
    }
  });
});

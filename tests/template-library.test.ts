import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { allObjects, parseDesignDocument, versionIdOfSrc, type DesignDocument } from "@/lib/design-doc";
import { TEMPLATE_LIBRARY } from "@/lib/template-library";
import { withSystem } from "@/server/db";
import { designs, fileVersions } from "@/server/db/schema";
import { env } from "@/server/env";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createDesign } from "@/server/services/designs";
import {
  canUseTemplateLibrary,
  installLibraryTemplate,
  listTemplateLibrary,
  renderPlaceholder,
} from "@/server/services/template-library";
import { addMember, as, createOrgWithOwner, resetDb } from "./helpers";

/*
 * Biblioteca de modelos: documentos válidos e dentro da página, imagens de
 * exemplo geradas e salvas em Arquivos da agência, template criado uma vez só,
 * e acesso só da conta administradora (ou da proprietária, sem ela configurada).
 */

type Ctx = Awaited<ReturnType<typeof createOrgWithOwner>>;
const fakeSrcs = (t: (typeof TEMPLATE_LIBRARY)[number]) =>
  Object.fromEntries(
    Object.keys(t.placeholders).map((k, i) => [k, `/api/files/00000000-0000-4000-8000-00000000000${i}`]),
  );

describe("modelos da biblioteca", () => {
  it.each(TEMPLATE_LIBRARY.map((t) => [t.key, t] as const))(
    "%s: documento válido, editável e dentro da página",
    (_k, t) => {
      const doc = parseDesignDocument(t.build(fakeSrcs(t)) as unknown as Record<string, unknown>);
      expect(doc.pages).toHaveLength(t.pages);
      expect(!!doc.meta?.carousel).toBe(t.pages > 1);
      const objects = [...allObjects(doc)].map((l) => l.object);
      // Textos são caixas de texto (editáveis), não imagens.
      expect(objects.filter((o) => o.type === "text").length).toBeGreaterThanOrEqual(t.pages * 3);
      for (const p of doc.pages) {
        expect(p.width).toBe(t.width);
        expect(p.height).toBe(t.height);
        for (const o of p.objects) {
          expect(o.x, `${t.key}/${o.name}`).toBeGreaterThanOrEqual(-1);
          expect(o.y, `${t.key}/${o.name}`).toBeGreaterThanOrEqual(-1);
          expect(o.x + o.width, `${t.key}/${o.name}`).toBeLessThanOrEqual(p.width + 1);
          expect(o.y + o.height, `${t.key}/${o.name}`).toBeLessThanOrEqual(p.height + 1);
        }
      }
      // Toda imagem de exemplo declarada é usada, e nenhuma imagem aponta para fora de Arquivos.
      const srcs = objects.flatMap((o) => (o.type === "image" ? [o.src] : []));
      expect(new Set(srcs)).toEqual(new Set(Object.values(fakeSrcs(t))));
    },
  );

  it("imagens de exemplo são JPEG no tamanho pedido", async () => {
    for (const t of TEMPLATE_LIBRARY) {
      for (const spec of Object.values(t.placeholders)) {
        const meta = await sharp(await renderPlaceholder(spec)).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", spec.width, spec.height]);
      }
    }
  });
});

describe("adicionar à agência", () => {
  let a: Ctx;
  let b: Ctx;
  const saved = env.ARAGONEZ_ADMIN;

  beforeAll(async () => {
    await resetDb();
    a = await createOrgWithOwner("Agência Modelos", "Dona");
    b = await createOrgWithOwner("Outra Agência", "Outro dono");
  });

  afterEach(() => {
    env.ARAGONEZ_ADMIN = saved;
  });

  it("cria o template com as imagens de exemplo em Arquivos da agência, uma vez só", async () => {
    env.ARAGONEZ_ADMIN = undefined;
    const before = await as(a.actor, (s) => listTemplateLibrary(s));
    expect(before?.map((i) => i.key)).toEqual(TEMPLATE_LIBRARY.map((t) => t.key));
    expect(before?.every((i) => i.installedId === null)).toBe(true);

    const { id } = await as(a.actor, (s) => installLibraryTemplate(s, "carrossel-editorial-claro"));
    const [row] = await withSystem((tx) => tx.select().from(designs).where(eq(designs.id, id)));
    expect(row).toMatchObject({ organizationId: a.org.id, isTemplate: true, name: "Carrossel editorial claro" });
    const doc = parseDesignDocument(row!.document as Record<string, unknown>) as DesignDocument;
    expect(doc.meta?.library).toEqual({ key: "carrossel-editorial-claro", version: 1 });
    expect(doc.pages).toHaveLength(5);

    // As imagens são versões de arquivos desta agência.
    const versionIds = [...allObjects(doc)].flatMap((l) =>
      l.object.type === "image" ? [versionIdOfSrc(l.object.src)!] : [],
    );
    expect(versionIds).toHaveLength(3);
    for (const v of versionIds) {
      const [fv] = await withSystem((tx) =>
        tx
          .select({ org: fileVersions.organizationId })
          .from(fileVersions)
          .where(and(eq(fileVersions.id, v))),
      );
      expect(fv?.org).toBe(a.org.id);
    }

    const after = await as(a.actor, (s) => listTemplateLibrary(s));
    expect(after?.find((i) => i.key === "carrossel-editorial-claro")?.installedId).toBe(id);
    await expect(as(a.actor, (s) => installLibraryTemplate(s, "carrossel-editorial-claro"))).rejects.toBeInstanceOf(
      ValidationError,
    );
    // Outra agência continua sem o modelo.
    const other = await as(b.actor, (s) => listTemplateLibrary(s));
    expect(other?.find((i) => i.key === "carrossel-editorial-claro")?.installedId).toBeNull();

    // Usar o template: arte nova com as mesmas páginas e imagens.
    const art = await as(a.actor, (s) =>
      createDesign(s, { name: "Carrossel do cliente", width: 1080, height: 1350, templateId: id }),
    );
    const [copy] = await withSystem((tx) => tx.select().from(designs).where(eq(designs.id, art.id)));
    expect((copy!.document as { pages: unknown[] }).pages).toHaveLength(5);
  });

  it("só a conta administradora (ou a proprietária, sem ARAGONEZ_ADMIN) usa a biblioteca", async () => {
    env.ARAGONEZ_ADMIN = undefined;
    const designer = await addMember(a.org.slug, a.org.id, "designer");
    expect(canUseTemplateLibrary(a.actor)).toBe(true);
    expect(canUseTemplateLibrary(designer)).toBe(false);
    expect(await as(designer, (s) => listTemplateLibrary(s))).toBeNull();
    await expect(as(designer, (s) => installLibraryTemplate(s, "capa-impacto"))).rejects.toBeInstanceOf(ForbiddenError);

    env.ARAGONEZ_ADMIN = b.owner.email;
    expect(canUseTemplateLibrary(a.actor)).toBe(false);
    expect(canUseTemplateLibrary(b.actor)).toBe(true);
    await expect(as(a.actor, (s) => installLibraryTemplate(s, "capa-impacto"))).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await as(b.actor, (s) => installLibraryTemplate(s, "capa-impacto"));
    expect(id).toBeTruthy();
  });

  it("modelo inexistente não cria nada", async () => {
    env.ARAGONEZ_ADMIN = undefined;
    await expect(as(a.actor, (s) => installLibraryTemplate(s, "nao-existe"))).rejects.toThrow(/não encontrado/);
  });
});

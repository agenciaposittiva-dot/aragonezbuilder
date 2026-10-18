import { BrandEditor } from "@/components/clients/brand-editor";
import { BrandLibrary } from "@/components/files/brand-library";
import { Section } from "@/components/ui/page-header";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getBrandProfile, getClient } from "@/server/services/clients";
import { BRAND_CATEGORIES, listFiles, maxUploadBytes } from "@/server/services/files";

export default async function ClientBrandPage({ params }: PageProps<"/w/[org]/clients/[id]/brand">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const data = await inOrg(actor, async (s) => {
    const brand = await getBrandProfile(s, id);
    const canFiles = can(actor, "files.read");
    return {
      brand,
      logoFileId: (await getClient(s, id)).client.logoFileId,
      files: canFiles ? (await listFiles(s, { clientId: id, categories: BRAND_CATEGORIES, pageSize: 200 })).rows : [],
      approved: canFiles ? (await listFiles(s, { clientId: id, final: true, pageSize: 24 })).rows : [],
      maxBytes: maxUploadBytes(s),
    };
  });
  const brand = data.brand;
  return (
    <div className="grid gap-10">
      <BrandEditor
        clientId={id}
        canWrite={can(actor, "clients.write")}
        brand={
          brand
            ? {
                toneOfVoice: brand.toneOfVoice,
                audience: brand.audience,
                objectives: brand.objectives,
                positioning: brand.positioning,
                keywords: brand.keywords,
                avoid: brand.avoid,
                guidelines: brand.guidelines,
                colors: brand.colors,
                fonts: brand.fonts,
              }
            : null
        }
      />
      {can(actor, "files.read") ? (
        <Section
          title="Biblioteca de marca"
          description="Arquivos oficiais do cliente, disponíveis para a equipe criativa e para o editor de artes."
        >
          <BrandLibrary
            clientId={id}
            files={data.files}
            approved={data.approved}
            logoFileId={data.logoFileId}
            canWrite={can(actor, "files.write")}
            canSetLogo={can(actor, "clients.write")}
            maxBytes={data.maxBytes}
          />
        </Section>
      ) : null}
    </div>
  );
}

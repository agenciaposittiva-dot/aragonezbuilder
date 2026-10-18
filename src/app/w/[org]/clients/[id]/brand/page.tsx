import { BrandEditor } from "@/components/clients/brand-editor";
import { can, inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { getBrandProfile } from "@/server/services/clients";

export default async function ClientBrandPage({ params }: PageProps<"/w/[org]/clients/[id]/brand">) {
  const { org, id } = await params;
  const actor = await requireActor(org, { kind: "internal", permission: "clients.read" });
  const brand = await inOrg(actor, (s) => getBrandProfile(s, id));
  return (
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
  );
}

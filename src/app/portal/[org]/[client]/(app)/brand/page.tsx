import { Palette } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { inOrg } from "@/server/authz";
import { requirePortal } from "@/server/auth/portal";
import { getBrandProfile, getClient } from "@/server/services/clients";

export const metadata: Metadata = { title: "Marca" };

export default async function PortalBrandPage({ params }: PageProps<"/portal/[org]/[client]/brand">) {
  const { org, client: clientSlug } = await params;
  const portal = await requirePortal(org, clientSlug, { permission: "clients.read" });
  const { actor } = portal;
  const brands = await inOrg(actor, async (s) => {
    const out = [];
    for (const clientId of actor.clientIds) {
      const detail = await getClient(s, clientId);
      out.push({ name: detail.client.name, brand: await getBrandProfile(s, clientId) });
    }
    return out;
  });
  return (
    <>
      <PageHeader title="Marca" description="Identidade e diretrizes cadastradas pela agência." />
      {brands.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState icon={Palette} title="Nenhuma marca disponível" />
        </div>
      ) : (
        <div className="grid gap-6">
          {brands.map(({ name, brand }) => (
            <section key={name} className="grid gap-4">
              {brands.length > 1 ? <h2 className="text-base font-semibold">{name}</h2> : null}
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Comunicação</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 text-sm">
                    {[
                      ["Tom de voz", brand?.toneOfVoice],
                      ["Público-alvo", brand?.audience],
                      ["Objetivos", brand?.objectives],
                      ["Posicionamento", brand?.positioning],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-fg-subtle">{label}</p>
                        <p className="mt-0.5 whitespace-pre-wrap">
                          {value || <span className="text-fg-subtle">Não informado</span>}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <div className="grid content-start gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle>Cores</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {brand?.colors.length ? (
                        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          {brand.colors.map((c) => (
                            <li key={c.hex + c.name} className="overflow-hidden rounded-lg border border-border">
                              <div className="h-14" style={{ background: c.hex }} />
                              <div className="px-2.5 py-1.5">
                                <p className="truncate text-xs font-medium">{c.name || "Cor"}</p>
                                <p className="text-[11px] text-fg-muted uppercase">{c.hex}</p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-fg-muted">Nenhuma cor cadastrada.</p>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Tipografia e diretrizes</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm">
                      <p>
                        {brand?.fonts.length
                          ? brand.fonts.map((f) => `${f.name}${f.usage ? ` (${f.usage})` : ""}`).join(" · ")
                          : "Nenhuma fonte cadastrada."}
                      </p>
                      {brand?.guidelines ? (
                        <p className="whitespace-pre-wrap text-fg-muted">{brand.guidelines}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

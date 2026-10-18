import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import { portalAssetUrl } from "@/lib/portal-assets";
import { parsePortalSettings } from "@/lib/portal-settings";
import { inOrg } from "@/server/authz";
import { requireActor } from "@/server/auth/session";
import { clientPortalSettings, clients } from "@/server/db/schema";

export const metadata: Metadata = { title: "Escolha o espaço", robots: { index: false } };

/** Entrada da área do cliente: leva direto ao portal do cliente ou mostra a escolha. */
export default async function PortalChooserPage({ params, searchParams }: PageProps<"/portal/[org]">) {
  const { org } = await params;
  const sp = await searchParams;
  const actor = await requireActor(org, { kind: "client", permission: "portal.access" });
  const rows = actor.clientIds.length
    ? await inOrg(actor, (s) =>
        s.db
          .select({
            id: clients.id,
            name: clients.name,
            slug: clients.slug,
            logoFileId: clients.logoFileId,
            published: clientPortalSettings.published,
            version: clientPortalSettings.version,
          })
          .from(clients)
          .leftJoin(clientPortalSettings, eq(clientPortalSettings.clientId, clients.id))
          .where(and(inArray(clients.id, [...actor.clientIds]), isNull(clients.archivedAt)))
          .orderBy(asc(clients.name)),
      )
    : [];
  const next = typeof sp.next === "string" && /^\/[a-z0-9/_-]*$/i.test(sp.next) ? sp.next : "";
  if (rows.length === 1 && sp.trocar !== "1") redirect(`/portal/${actor.orgSlug}/${rows[0]!.slug}${next}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <LogoMark className="size-9" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Escolha o espaço</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {rows.length
            ? `Você tem acesso a ${rows.length} ${rows.length === 1 ? "cliente" : "clientes"} em ${actor.orgName}.`
            : "Sua conta ainda não tem acesso a nenhum cliente. Fale com a agência."}
        </p>
      </div>
      <ul className="grid gap-2">
        {rows.map((c) => {
          const settings = parsePortalSettings(c.published);
          const hasLogo = !!(settings.logoFileId || c.logoFileId);
          return (
            <li key={c.id}>
              <Link
                href={`/portal/${actor.orgSlug}/${c.slug}${next}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <Avatar
                  name={settings.displayName ?? c.name}
                  src={hasLogo ? portalAssetUrl(c.id, "logo", { v: c.version ?? 0 }) : null}
                  square
                  className={hasLogo ? "bg-surface ring-1 ring-border [&_img]:object-contain" : undefined}
                />
                <span className="truncate text-sm font-medium">{settings.displayName ?? c.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

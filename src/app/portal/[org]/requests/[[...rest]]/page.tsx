import { redirect } from "next/navigation";

/** Endereço antigo da área do cliente: encaminha para o portal do cliente certo. */
export default async function LegacyPortalRedirect({ params }: PageProps<"/portal/[org]/requests/[[...rest]]">) {
  const { org, rest = [] } = await params;
  redirect(`/portal/${org}/ir/requests${rest.length ? `/${rest.join("/")}` : ""}`);
}

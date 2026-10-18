"use client";

import { useEffect } from "react";

/** Lembra a última organização acessada (usada no redirecionamento de "/"). */
export function RememberOrg({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `last_org=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}

/** Lembra o último portal de cliente aberto na organização (usado nos links genéricos /ir). */
export function RememberPortalClient({ orgSlug, clientSlug }: { orgSlug: string; clientSlug: string }) {
  useEffect(() => {
    document.cookie = `pc_${encodeURIComponent(orgSlug)}=${encodeURIComponent(clientSlug)}; path=/portal/${encodeURIComponent(orgSlug)}; max-age=31536000; samesite=lax`;
  }, [orgSlug, clientSlug]);
  return null;
}

"use client";

import { useEffect } from "react";

/** Lembra a última organização acessada (usada no redirecionamento de "/"). */
export function RememberOrg({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `last_org=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}

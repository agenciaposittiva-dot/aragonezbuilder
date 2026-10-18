"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/safe-action";
import { accessKeyMatches, accessKeyRequired } from "@/server/access-key";
import { createOrganization } from "@/server/services/organizations";

export async function createOrganizationAction(input: {
  name: string;
  slug?: string;
  accessKey?: string;
}): Promise<ActionResult<never>> {
  const session = await requireSession();
  if (accessKeyRequired(session.user.email) && !accessKeyMatches(input.accessKey?.trim())) {
    // Atraso fixo para desencorajar tentativas em sequência.
    await new Promise((r) => setTimeout(r, 800));
    const error = "Chave de acesso inválida.";
    return { ok: false, error, fieldErrors: { accessKey: [error] } };
  }
  let slug: string;
  try {
    const org = await createOrganization(session.user.id, {
      name: input.name,
      slug: input.slug?.trim() ? input.slug : undefined,
    });
    slug = org.slug;
  } catch (err) {
    return toActionError(err);
  }
  redirect(`/w/${slug}`);
}

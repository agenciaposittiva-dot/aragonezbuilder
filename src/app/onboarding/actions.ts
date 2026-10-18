"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/safe-action";
import { accessKeyMatches, agencyCreationAccess } from "@/server/access-key";
import { createOrganization } from "@/server/services/organizations";

export async function createOrganizationAction(input: {
  name: string;
  slug?: string;
  accessKey?: string;
  /** Devolve o endereço em vez de redirecionar (o formulário ainda vai enviar a logo). */
  returnSlug?: boolean;
}): Promise<ActionResult<{ slug: string }>> {
  const session = await requireSession();
  const access = await agencyCreationAccess(session.user.id, session.user.email);
  if (access === "denied") {
    return {
      ok: false,
      error: "Criar agências é restrito a quem já administra uma agência. Peça ao administrador da plataforma.",
      code: "forbidden",
    };
  }
  if (access === "key" && !accessKeyMatches(input.accessKey?.trim())) {
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
  if (input.returnSlug) return { ok: true, data: { slug } };
  redirect(`/w/${slug}`);
}

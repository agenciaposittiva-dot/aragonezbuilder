"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/session";
import { toActionError, type ActionResult } from "@/server/actions/safe-action";
import { createOrganization } from "@/server/services/organizations";

export async function createOrganizationAction(input: { name: string; slug?: string }): Promise<ActionResult<never>> {
  const session = await requireSession();
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

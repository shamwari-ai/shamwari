import { redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import type { LayoutServerLoad } from "./$types";

/**
 * Auth guard for everything under /dashboard. AuthKit's hook populates
 * `locals.auth`; if there's no user we bounce to the AuthKit-hosted
 * sign-in flow with a returnTo back here.
 */
export const load: LayoutServerLoad = ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Dashboard",
      description: "Your Shamwari AI developer dashboard.",
      noindex: true,
    }),
    user: locals.auth.user,
    organizationId: locals.auth.organizationId ?? null,
  };
};

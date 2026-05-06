import { redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import type { PageServerLoad } from "./$types";

/**
 * Auth-guarded chat surface. AuthKit's hook populates `locals.auth`;
 * if there's no user we bounce to AuthKit's hosted sign-in flow.
 */
export const load: PageServerLoad = ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Chat",
      description:
        "Chat with Shamwari AI in English, Shona, or Ndebele. Free tier with sensible rate limits, no credit card required.",
    }),
    user: locals.auth.user,
  };
};

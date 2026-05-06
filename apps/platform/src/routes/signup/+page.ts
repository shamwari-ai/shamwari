import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Create an account",
    description:
      "Create a Shamwari AI developer account. Free tier with rate-limited API access, no credit card required.",
  }),
});

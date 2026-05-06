import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Overview",
    description: "Your Shamwari AI account overview — usage, keys, and recent activity.",
    noindex: true,
  }),
});

import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Recover access",
    description:
      "Recover access to your Shamwari AI account. We send a one-time code by email.",
  }),
});

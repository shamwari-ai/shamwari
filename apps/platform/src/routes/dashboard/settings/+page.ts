import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Settings",
    description: "Update your Shamwari AI account profile and preferences.",
    noindex: true,
  }),
});

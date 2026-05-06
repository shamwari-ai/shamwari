import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Developer portal",
    description:
      "Sign in to manage your Shamwari AI API keys, monitor usage, and pay for higher limits.",
  }),
});

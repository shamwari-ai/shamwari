import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Developer documentation",
    description:
      "Build with Shamwari AI — quickstart, authentication, chat completions, model cards, rate limits, and SDKs.",
  }),
});

import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Pricing",
    description:
      "Shamwari AI pricing — free chat with rate limits, a developer tier with API access, and self-hosted options. Open weights are always free.",
  }),
});

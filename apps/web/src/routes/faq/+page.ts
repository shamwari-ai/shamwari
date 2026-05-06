import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Frequently asked questions",
    description:
      "Direct answers to the questions we get most about Shamwari AI — languages, pricing, self-hosting, data, and how it differs from ChatGPT.",
  }),
});

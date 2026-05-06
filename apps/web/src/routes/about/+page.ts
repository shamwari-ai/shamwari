import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "About Shamwari AI",
    description:
      "Shamwari AI is built by Nyuchi Africa, founded by Bryan Fawcett. Our mission is open-source AI that works for African languages, devices, and contexts.",
  }),
});

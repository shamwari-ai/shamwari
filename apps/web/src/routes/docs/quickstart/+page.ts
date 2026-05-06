import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Quickstart",
    description:
      "Send your first Shamwari AI chat completion in under five minutes — get a key, install the client, make a request.",
  }),
});

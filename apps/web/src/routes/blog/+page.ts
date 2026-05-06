import { buildMeta } from "$lib/seo/meta";
import { posts } from "./posts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Blog",
    description:
      "Updates, technical notes, and language-model research from the Shamwari AI team.",
  }),
  posts,
});

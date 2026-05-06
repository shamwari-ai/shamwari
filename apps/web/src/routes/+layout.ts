import { buildMeta } from "$lib/seo/meta";
import type { LayoutLoad } from "./$types";

export const load: LayoutLoad = ({ url }) => {
  return {
    meta: buildMeta({
      pathname: url.pathname,
    }),
  };
};

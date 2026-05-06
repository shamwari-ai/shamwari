import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Open-source AI built for Africa",
      description:
        "Shamwari AI is open-source AI built for Africa — small enough to run locally, multilingual (English, Shona, Ndebele), and culturally grounded.",
    }),
  };
};

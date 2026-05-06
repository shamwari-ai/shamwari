import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Billing",
    description: "Manage your Shamwari AI plan, payment method, and invoices.",
    noindex: true,
  }),
});

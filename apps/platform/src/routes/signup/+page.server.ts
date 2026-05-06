import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** Forward to the AuthKit-hosted sign-up flow. */
export const load: PageServerLoad = ({ url }) => {
  const returnTo = url.searchParams.get("returnTo") ?? "/dashboard";
  throw redirect(302, `/sign-up?returnTo=${encodeURIComponent(returnTo)}`);
};

import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const returnTo = url.searchParams.get("returnTo") ?? "/dashboard";
  const signInUrl = await authKit.getSignInUrl({ returnTo });
  throw redirect(302, signInUrl);
};

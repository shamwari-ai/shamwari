import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const returnTo = url.searchParams.get("returnTo") ?? "/dashboard";
  // AuthKit's sign-in URL handles both sign-in and sign-up via the hosted UI;
  // a hint pushes the form into sign-up mode on first paint.
  const signInUrl = await authKit.getSignInUrl({ returnTo });
  throw redirect(302, `${signInUrl}#sign-up`);
};

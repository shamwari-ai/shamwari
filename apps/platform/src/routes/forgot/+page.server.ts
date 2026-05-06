import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** Forward to AuthKit; recovery is handled inside the hosted flow. */
export const load: PageServerLoad = () => {
  throw redirect(302, "/sign-in");
};

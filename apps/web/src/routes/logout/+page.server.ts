import { redirect } from "@sveltejs/kit";
import { authKit } from "@workos/authkit-sveltekit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  throw redirect(303, "/");
};

export const actions: Actions = {
  default: async (event) => {
    return authKit.signOut(event);
  },
};

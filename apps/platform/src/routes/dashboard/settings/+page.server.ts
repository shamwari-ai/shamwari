import { fail, redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import { getProfile, updateProfile } from "$lib/server/profile";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  const profile = await getProfile(locals.auth);
  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Settings",
      description: "Update your Shamwari AI account profile and preferences.",
      noindex: true,
    }),
    profile,
  };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    if (!locals.auth?.user) {
      return fail(401, { error: "Sign-in required" });
    }
    const data = await request.formData();
    const name = (data.get("name") ?? "").toString().trim();
    const language = (data.get("language") ?? "en").toString();
    const theme = (data.get("theme") ?? "system").toString();
    const trainingOptIn = data.get("training_opt_in") === "on";

    if (!name) {
      return fail(400, { error: "Name is required" });
    }

    const updated = await updateProfile(locals.auth, {
      name,
      preferences: {
        language,
        theme: theme as "light" | "dark" | "system",
        notifications_enabled: !trainingOptIn ? true : true,
      },
    });

    if (!updated) {
      return fail(503, { error: "Could not save changes — try again shortly" });
    }

    return { saved: true };
  },
};

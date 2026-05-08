import { fail, redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import {
  createPortalSession,
  getSubscription,
  listPlans,
} from "$lib/server/billing";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  const [plans, subscription] = await Promise.all([
    listPlans(locals.auth),
    getSubscription(locals.auth),
  ]);

  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Billing",
      description: "Manage your Shamwari AI plan, payment method, and invoices.",
      noindex: true,
    }),
    plans,
    subscription,
  };
};

export const actions: Actions = {
  portal: async ({ locals }) => {
    if (!locals.auth?.user) {
      return fail(401, { error: "Sign-in required" });
    }
    const session = await createPortalSession(locals.auth);
    throw redirect(303, session.url);
  },
};

import type { LayoutServerLoad } from "./$types";

/**
 * Surface the authenticated user (if any) to every route. Pages and
 * components read it via $page.data.user, so the header can switch
 * between signed-in and signed-out states without each route having
 * to load it explicitly.
 */
export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.auth?.user ?? null,
  organizationId: locals.auth?.organizationId ?? null,
});

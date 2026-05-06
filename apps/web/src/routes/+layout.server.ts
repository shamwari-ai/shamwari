import type { LayoutServerLoad } from "./$types";

/**
 * Surface the authenticated user (if any) to every route. The chat
 * surface needs to know who is asking; marketing pages just adapt
 * their CTAs.
 */
export const load: LayoutServerLoad = ({ locals }) => ({
  user: locals.auth?.user ?? null,
  organizationId: locals.auth?.organizationId ?? null,
});

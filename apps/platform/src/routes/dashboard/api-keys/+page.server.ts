import { fail, redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from "$lib/server/api-keys";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  const keys = await listApiKeys(locals.auth);
  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "API keys",
      description: "Issue, rotate, and revoke Shamwari AI API keys.",
      noindex: true,
    }),
    keys,
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    if (!locals.auth?.user) {
      return fail(401, { error: "Sign-in required" });
    }
    const data = await request.formData();
    const label = String(data.get("label") ?? "").trim();
    if (!label) {
      return fail(400, { error: "Label is required" });
    }
    if (label.length > 64) {
      return fail(400, { error: "Label must be 64 characters or fewer" });
    }
    const created = await createApiKey(locals.auth, label);
    return {
      created: {
        id: created.id,
        label: created.label,
        prefix: created.prefix,
        secret: created.secret,
      },
    };
  },

  revoke: async ({ request, locals }) => {
    if (!locals.auth?.user) {
      return fail(401, { error: "Sign-in required" });
    }
    const data = await request.formData();
    const id = String(data.get("id") ?? "");
    if (!id) {
      return fail(400, { error: "Missing key id" });
    }
    const removed = await revokeApiKey(locals.auth, id);
    if (!removed) {
      return fail(404, { error: "Key not found" });
    }
    return { revoked: id };
  },
};

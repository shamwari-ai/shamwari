import { redirect } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import { getUsage, type UsageRange } from "$lib/server/usage";
import type { PageServerLoad } from "./$types";

const RANGES: UsageRange[] = ["7d", "30d", "90d"];

function parseRange(value: string | null): UsageRange {
  return RANGES.includes(value as UsageRange) ? (value as UsageRange) : "30d";
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (!locals.auth?.user) {
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(302, `/sign-in?returnTo=${returnTo}`);
  }

  const range = parseRange(url.searchParams.get("range"));
  const usage = await getUsage(locals.auth, range);
  return {
    meta: buildMeta({
      pathname: url.pathname,
      title: "Usage",
      description:
        "Daily and monthly Shamwari AI token usage broken down per API key.",
      noindex: true,
    }),
    usage,
  };
};

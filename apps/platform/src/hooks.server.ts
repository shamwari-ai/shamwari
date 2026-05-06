import { sequence } from "@sveltejs/kit/hooks";
import { configureAuthKit, authKitHandle } from "@workos/authkit-sveltekit";
import { env } from "$env/dynamic/private";
import type { Handle } from "@sveltejs/kit";

configureAuthKit({
  clientId: env.WORKOS_CLIENT_ID,
  apiKey: env.WORKOS_API_KEY,
  redirectUri: env.WORKOS_REDIRECT_URI,
  cookiePassword: env.WORKOS_COOKIE_PASSWORD,
});

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);

  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  response.headers.set("X-DNS-Prefetch-Control", "on");

  return response;
};

export const handle = sequence(authKitHandle(), securityHeaders);

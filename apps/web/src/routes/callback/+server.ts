import { authKit } from "@workos/authkit-sveltekit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const handler = authKit.handleCallback();
  return handler(event);
};

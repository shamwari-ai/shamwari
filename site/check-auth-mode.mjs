// The auth mode the built chat page was built in, and whether that is acceptable. Used by check.mjs (so CI fails on a bad build)
// and by test/app/auth-mode.test.ts. Mukoko sign-in is the default and the only mode a release may ship in; a build may
// come out in the developer-key mode only when it asked for it by name (PUBLIC_CHAT_AUTH=developer-key), for local work.
export function builtAuthMode(html) {
  return html.match(/<meta\s+name="shamwari-auth"\s+content="([^"]*)"/)?.[1] ?? null;
}

/** null when the page is in the mode this build asked for (Mukoko by default); otherwise what is wrong, in words. */
export function authModeProblem(html, env = process.env) {
  const asked = env.PUBLIC_CHAT_AUTH === 'developer-key';
  const want = asked ? 'developer-key' : 'mukoko';
  const got = builtAuthMode(html);
  if (got === want) return null;
  if (got === null) return 'the built /lite/ page has no <meta name="shamwari-auth">: the page would not know how to sign people in';
  return (
    `the built /lite/ page is in "${got}" mode, expected "${want}"` +
    (want === 'mukoko'
      ? ': a release must sign people in with Mukoko (the developer-key screen says "Mukoko sign-in is coming soon"); only PUBLIC_CHAT_AUTH=developer-key may build that screen'
      : '')
  );
}

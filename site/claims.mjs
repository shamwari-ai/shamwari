// The language rules from CLAUDE.md, as functions, so check.mjs can hold every
// built page to them and can prove, on fixtures, that they fail when broken.
//
//   Sovereignty attaches to Mind + Ground only. Never to Cloud.
//   Say "open weights", not "open source model".
//   "We train Shamwari Mind. We route Shamwari Cloud." (never "we built our own model")

// A sentence that ties Cloud to sovereignty or residency is a problem unless it
// is one of the denials below. A list of allowed denials, not a search for
// negation words: "never leaves Africa" and "isn't the only option, and your
// data stays in Africa" both contain a negation and are both the forbidden claim.
const SOVEREIGN = /(sovereign\w*|stays? in africa|remains? in africa|data residency|never leaves (africa|zimbabwe)|in-country)/i;
const DENIAL = [
  /sovereignty (applies|attaches) to mind and ground(?: only)?\b/i,
  /\b(does not|doesn't|never) apply to cloud\b/i,
  /\bnever to cloud\b/i,
  /\bnot to cloud\b/i,
  /\bcloud (is not|isn't|cannot|can't|does not|doesn't) (be )?(sovereign|claim|promise|keep)/i,
  /\bnot (a |an )?sovereign cloud\b/i,
];

/** Sentences are split on . ! ? and on the block boundaries check.mjs flattens. */
const sentences = (text) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);

export function findClaimProblems(text) {
  const problems = [];
  for (const s of sentences(text)) {
    if (/\bcloud\b/i.test(s) && SOVEREIGN.test(s) && !DENIAL.some((d) => d.test(s))) {
      problems.push(`claims sovereignty or residency for Cloud: "${s.slice(0, 140)}"`);
    }
    if (/open[- ]source (model|ai|llm|weights)/i.test(s) && !/\b(not|never|say|rather than|instead of)\b/i.test(s)) {
      problems.push(`says "open source model"; say "open weights": "${s.slice(0, 140)}"`);
    }
    if (/(we (built|trained|made|created) our own (model|llm)|our own (foundation )?model)/i.test(s) && !/\b(not|never|no)\b/i.test(s)) {
      problems.push(`claims we built our own model; we train Mind and route Cloud: "${s.slice(0, 140)}"`);
    }
    if (/sovereign cloud/i.test(s) && !DENIAL.some((d) => d.test(s))) {
      problems.push(`"sovereign cloud" is a claim Cloud cannot make: "${s.slice(0, 140)}"`);
    }
  }
  return problems;
}

/** Fixtures that must fail, and ones that must pass. check.mjs runs these first. */
export function selfTest() {
  const bad = [
    'Your data stays in Africa with Shamwari Cloud.',
    'Shamwari Cloud is sovereign AI.',
    'Our Cloud keeps data residency in Zimbabwe.',
    'Shamwari is an open source model for Africa.',
    'We built our own model.',
    'A sovereign cloud for Zimbabwe.',
    'With Shamwari Cloud your data never leaves Africa.',
    'Cloud isn\'t the only option, and your data stays in Africa.',
    'Shamwari is a noteworthy open source model for Africa.',
    'Nothing beats our open source model.',
  ];
  const good = [
    'Sovereignty applies to Mind and Ground. It does not apply to Cloud.',
    'Sovereignty attaches to Mind and Ground only. Never to Cloud.',
    'Say open weights, not open source model.',
    'We train Shamwari Mind. We route Shamwari Cloud.',
    'Personal data never goes to Cloud.',
  ];
  const failures = [];
  for (const t of bad) if (!findClaimProblems(t).length) failures.push(`should have failed: ${t}`);
  for (const t of good) if (findClaimProblems(t).length) failures.push(`should have passed: ${t}`);
  return failures;
}

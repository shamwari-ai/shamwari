<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const lastReviewed = "2026-05-06";

  const policyLd = {
    "@context": "https://schema.org" as const,
    "@type": "WebPage",
    name: "Privacy policy",
    url: `${SITE.url}/privacy`,
    dateModified: lastReviewed,
    inLanguage: "en",
  };

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Privacy", url: `${SITE.url}/privacy` },
  ]);
</script>

<JsonLd data={policyLd} />
<JsonLd data={crumbs} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">Privacy policy</h1>
  <p class="mt-2 text-sm text-muted-foreground">Last reviewed: {lastReviewed}</p>
  <p class="mt-6 text-lg text-muted-foreground">
    We keep this short and direct. Our defaults are private. Your conversations
    belong to you, and we are not in the business of training on them.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Data we collect</h2>
  <ul class="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
    <li>Account info: email, optional name, account creation date.</li>
    <li>
      Chat content: stored in your per-user CouchDB database, encrypted in
      transit and at rest.
    </li>
    <li>
      Usage telemetry: aggregated, anonymized API counts for billing and
      capacity planning.
    </li>
    <li>
      Cookies: a session cookie for auth, and a preference cookie for theme.
    </li>
  </ul>

  <h2 class="mt-10 text-2xl font-semibold">How we use it</h2>
  <p class="mt-3 text-muted-foreground">
    To run the service, prevent abuse, and bill paid tiers. We do not sell
    your data, share it with advertisers, or train future model versions on
    it without explicit opt-in.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Where it's stored</h2>
  <p class="mt-3 text-muted-foreground">
    Production data lives in CouchDB hosted on Fly.io in Johannesburg, with
    backups encrypted in Cloudflare R2. Session auth runs through Stytch.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Your rights</h2>
  <p class="mt-3 text-muted-foreground">
    Under Zimbabwe's Data Protection Act and the EU GDPR, you can access,
    correct, export, or delete your data. Email
    <a href="mailto:privacy@shamwari.ai" class="underline underline-offset-4"
      >privacy@shamwari.ai</a
    > and we will respond within 30 days.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Children</h2>
  <p class="mt-3 text-muted-foreground">
    Shamwari AI is not directed at children under 13. We do not knowingly
    collect their data; if you believe we have, tell us and we will delete it.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Contact</h2>
  <p class="mt-3 text-muted-foreground">
    Questions, concerns, or data requests: <a
      href="mailto:privacy@shamwari.ai"
      class="underline underline-offset-4">privacy@shamwari.ai</a
    >.
  </p>
</article>

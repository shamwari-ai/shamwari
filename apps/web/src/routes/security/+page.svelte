<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Security", url: `${SITE.url}/security` },
  ]);
</script>

<JsonLd data={crumbs} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">Security at Shamwari AI</h1>
  <p class="mt-4 text-lg text-muted-foreground">
    Security is operational, not a marketing badge. Here is what we do today
    and where to reach us if something looks wrong.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Where data lives</h2>
  <p class="mt-3 text-muted-foreground">
    Production data is hosted on Fly.io in Johannesburg. CouchDB stores
    operational data per user; Cloudflare R2 holds object storage; Supabase
    backs auth metadata. Backups are encrypted at rest in R2.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Encryption</h2>
  <p class="mt-3 text-muted-foreground">
    TLS 1.2+ for all transport, HSTS preload set on the apex. Database
    connections are TLS-only. Secrets live in Fly secrets and Vercel
    encrypted env vars; we never check them into git.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Model isolation</h2>
  <p class="mt-3 text-muted-foreground">
    Inference workers are containerized and stateless. Per-user CouchDB
    databases mean prompts never share a multi-tenant blob; sync uses
    short-lived session tokens.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Responsible disclosure</h2>
  <p class="mt-3 text-muted-foreground">
    Found something? Email <a
      href="mailto:security@shamwari.ai"
      class="underline underline-offset-4">security@shamwari.ai</a
    > with steps to reproduce. We respond within 72 hours and ask for 90 days
    before public disclosure on anything that exposes user data. See
    <a href="/.well-known/security.txt" class="underline underline-offset-4"
      >security.txt</a
    >.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Open-source audits</h2>
  <p class="mt-3 text-muted-foreground">
    Code is MIT-licensed at <a
      href="https://github.com/nyuchitech/shamwari-ai"
      class="underline underline-offset-4"
      rel="noopener">github.com/nyuchitech/shamwari-ai</a
    >. Issues, advisories, and pull requests on security topics are welcome.
  </p>
</article>

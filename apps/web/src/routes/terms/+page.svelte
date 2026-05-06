<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const lastReviewed = "2026-05-06";
  const termsLd = {
    "@context": "https://schema.org" as const,
    "@type": "WebPage",
    name: "Terms of service",
    url: `${SITE.url}/terms`,
    dateModified: lastReviewed,
  };
  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Terms", url: `${SITE.url}/terms` },
  ]);
</script>

<JsonLd data={termsLd} />
<JsonLd data={crumbs} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">Terms of service</h1>
  <p class="mt-2 text-sm text-muted-foreground">Last reviewed: {lastReviewed}</p>

  <h2 class="mt-10 text-2xl font-semibold">Acceptable use</h2>
  <p class="mt-3 text-muted-foreground">
    Use Shamwari AI for lawful purposes. Do not use it to generate content
    that violates Zimbabwean law, infringes others' rights, or facilitates
    targeted harassment, illegal weapons, CSAM, or large-scale disinformation.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Open-source licence</h2>
  <p class="mt-3 text-muted-foreground">
    The model weights, training code, and platform code are released under
    the MIT licence (SPDX: <code>MIT</code>). You can use, modify, and
    distribute them freely, including commercially. The licence text lives
    in the GitHub repository.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">API limits</h2>
  <p class="mt-3 text-muted-foreground">
    Free tier accounts are rate-limited to keep the service usable for
    everyone. Paid tiers publish their own limits in the dashboard. We will
    give 30 days' notice before tightening any documented limit.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Liability</h2>
  <p class="mt-3 text-muted-foreground">
    Shamwari AI is provided "as is". To the extent permitted by law we do
    not accept liability for indirect or consequential losses. Direct
    liability is capped at the fees you paid us in the previous 12 months.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Governing law</h2>
  <p class="mt-3 text-muted-foreground">
    These terms are governed by the laws of Zimbabwe. Disputes go to the
    courts of Harare unless an alternative forum is required by law.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Contact</h2>
  <p class="mt-3 text-muted-foreground">
    Questions about these terms: <a
      href="mailto:legal@shamwari.ai"
      class="underline underline-offset-4">legal@shamwari.ai</a
    >.
  </p>
</article>

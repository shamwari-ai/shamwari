<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const founderLd = {
    "@context": "https://schema.org" as const,
    "@type": "Person",
    name: "Bryan Fawcett",
    jobTitle: "Founder & CEO",
    affiliation: {
      "@type": "Organization",
      name: "Nyuchi Africa",
      url: "https://nyuchi.africa",
    },
    sameAs: [
      "https://github.com/bryanfawcett",
      "https://www.linkedin.com/in/bryanfawcett",
    ],
  };

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "About", url: `${SITE.url}/about` },
  ]);
</script>

<JsonLd data={founderLd} />
<JsonLd data={crumbs} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">About Shamwari AI</h1>
  <p class="mt-4 text-lg text-muted-foreground">
    Shamwari AI is open-source AI built for Africa — small enough to run
    locally, multilingual on day one, and grounded in the languages, cultures,
    and devices that the continent actually uses.
  </p>

  <h2 class="mt-12 text-2xl font-semibold">Who builds Shamwari AI?</h2>
  <p class="mt-3 text-muted-foreground">
    Shamwari AI is built by <a
      href="https://nyuchi.africa"
      class="underline underline-offset-4">Nyuchi Africa</a
    >, a Zimbabwean technology company building open-source, community-based
    platforms. Nyuchi was founded by <strong>Bryan Fawcett</strong> in Harare.
    The development division, Nyuchi Web Services, ships the model and the
    platform together as one MIT-licensed project.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Why a small model?</h2>
  <p class="mt-3 text-muted-foreground">
    Most foundation models assume cheap compute, big GPUs, and constant
    bandwidth. African builders rarely get all three. Shamwari targets 1B–7B
    parameters quantizable for affordable Android devices, with a cloud API
    for higher-quality inference when network and budget allow. We optimize
    for "useful on a Tecno", not "leaderboard at the lab".
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Why focus on Africa?</h2>
  <p class="mt-3 text-muted-foreground">
    "Shamwari" is Shona for friend. The name is the brief: a model trained on
    African languages, idiom, and context, by a team that lives here. We start
    with English, Shona, and Ndebele, and expand outward from Southern Africa.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Is Shamwari open source?</h2>
  <p class="mt-3 text-muted-foreground">
    Yes — model weights, training code, and platform code are MIT licensed.
    The repository lives at <a
      href="https://github.com/nyuchitech/shamwari-ai"
      class="underline underline-offset-4"
      rel="noopener">github.com/nyuchitech/shamwari-ai</a
    >. Audits, forks, and contributions are welcome.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">How do I get involved?</h2>
  <p class="mt-3 text-muted-foreground">
    Read <a href="/docs" class="underline underline-offset-4">the docs</a>,
    grab an <a
      href="https://platform.shamwari.ai"
      class="underline underline-offset-4">API key</a
    >, or open an issue on GitHub. We respond.
  </p>
</article>

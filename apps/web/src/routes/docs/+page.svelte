<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const cards = [
    {
      title: "Quickstart",
      href: "/docs/quickstart",
      body: "Send your first chat completion in five minutes.",
    },
    {
      title: "Authentication",
      href: "https://platform.shamwari.ai",
      body: "Manage API keys and rotate them from platform.shamwari.ai.",
    },
    {
      title: "Chat completions",
      href: "/docs/chat-completions",
      body: "POST /v1/chat/completions — request and response shapes.",
    },
    {
      title: "Model cards",
      href: "/docs/models",
      body: "Sizes, languages, quantization options, and benchmarks.",
    },
    {
      title: "Rate limits",
      href: "/docs/rate-limits",
      body: "Free, Developer, and Business tier limits in one place.",
    },
    {
      title: "SDKs",
      href: "https://github.com/nyuchitech/shamwari-ai",
      body: "TypeScript, Python, and Swift clients.",
    },
  ];

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Docs", url: `${SITE.url}/docs` },
  ]);
</script>

<JsonLd data={crumbs} />

<section class="mx-auto max-w-6xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">
    Shamwari AI documentation
  </h1>
  <p class="mt-4 max-w-2xl text-lg text-muted-foreground">
    Build with Shamwari AI — open weights, predictable APIs, and docs written
    for engineers who ship.
  </p>
  <div class="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
    {#each cards as card}
      <a
        href={card.href}
        class="rounded-lg border border-border bg-card p-6 transition-colors hover:bg-muted"
        rel={card.href.startsWith("http") ? "noopener" : undefined}
      >
        <h2 class="font-semibold">{card.title}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{card.body}</p>
      </a>
    {/each}
  </div>
</section>

<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb, faqPage } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const tiers = [
    {
      name: "Free",
      price: "$0",
      cadence: "forever",
      summary: "Chat with Shamwari, rate-limited. Open weights for self-host.",
      features: [
        "Chat at shamwari.ai",
        "Open weights, MIT licensed",
        "Community support on GitHub",
      ],
      cta: { label: "Start chatting", href: "/chat" },
      highlight: false,
    },
    {
      name: "Developer",
      price: "$19",
      cadence: "per month",
      summary: "API access with usage dashboards and higher rate limits.",
      features: [
        "API keys via platform.shamwari.ai",
        "1M tokens per month included",
        "Usage dashboards and alerting",
        "Email support",
      ],
      cta: { label: "Get an API key", href: "https://platform.shamwari.ai" },
      highlight: true,
    },
    {
      name: "Business",
      price: "Custom",
      cadence: "talk to us",
      summary: "Dedicated capacity, on-prem deploys, and language tuning.",
      features: [
        "Dedicated inference capacity",
        "On-prem or single-tenant cloud",
        "Custom language tuning (Shona, Ndebele, more)",
        "SLA-backed support",
      ],
      cta: { label: "Contact sales", href: "mailto:sales@shamwari.ai" },
      highlight: false,
    },
  ];

  const faqs = [
    {
      question: "Is there a free tier?",
      answer:
        "Yes. Free includes chat at shamwari.ai with sensible rate limits, and the full open-source model weights you can run yourself with no fee.",
    },
    {
      question: "Do you charge per token?",
      answer:
        "The Developer tier includes 1M tokens per month for a flat $19. Above that we bill per million tokens. Business tiers move to dedicated capacity.",
    },
    {
      question: "Can I self-host Shamwari AI?",
      answer:
        "Yes. The model weights and inference code are MIT-licensed and run on commodity GPUs and quantized on Android. Self-hosting is free; you only pay if you use our API.",
    },
    {
      question: "Do you offer non-profit pricing?",
      answer:
        "Yes — registered non-profits and educational institutions across Africa get the Developer tier at no cost. Email us from your institutional address.",
    },
  ];

  const offerCatalogLd = {
    "@context": "https://schema.org" as const,
    "@type": "OfferCatalog",
    name: "Shamwari AI plans",
    itemListElement: tiers.map((tier) => ({
      "@type": "Offer",
      name: tier.name,
      description: tier.summary,
      price: tier.price === "Custom" ? "0" : tier.price.replace("$", ""),
      priceCurrency: "USD",
      url: `${SITE.url}/pricing`,
    })),
  };

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Pricing", url: `${SITE.url}/pricing` },
  ]);
</script>

<JsonLd data={offerCatalogLd} />
<JsonLd data={faqPage(faqs)} />
<JsonLd data={crumbs} />

<section class="border-b border-border/60">
  <div class="mx-auto max-w-3xl px-4 py-16 text-center">
    <h1 class="text-4xl font-bold tracking-tight">Shamwari AI pricing</h1>
    <p class="mt-4 text-lg text-muted-foreground">
      Free to use, free to run yourself, fair to scale on. Open weights are
      always MIT-licensed.
    </p>
  </div>
</section>

<section class="border-b border-border/60">
  <div class="mx-auto max-w-6xl px-4 py-16">
    <div class="grid gap-6 md:grid-cols-3">
      {#each tiers as tier}
        <div
          class="flex flex-col rounded-lg border bg-card p-6 {tier.highlight
            ? 'border-primary'
            : 'border-border'}"
        >
          <div class="flex-1">
            <h2 class="text-xl font-semibold">{tier.name}</h2>
            <p class="mt-2 text-3xl font-bold tracking-tight">
              {tier.price}
              <span class="ml-1 text-base font-normal text-muted-foreground"
                >{tier.cadence}</span
              >
            </p>
            <p class="mt-3 text-sm text-muted-foreground">{tier.summary}</p>
            <ul class="mt-6 space-y-2 text-sm">
              {#each tier.features as feature}
                <li class="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{feature}</span>
                </li>
              {/each}
            </ul>
          </div>
          <a
            href={tier.cta.href}
            class="mt-6 inline-flex w-full justify-center rounded-md px-4 py-2 text-sm {tier.highlight
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'border border-border hover:bg-muted'}"
            rel={tier.cta.href.startsWith("http") ? "noopener" : undefined}
          >
            {tier.cta.label}
          </a>
        </div>
      {/each}
    </div>
  </div>
</section>

<section>
  <div class="mx-auto max-w-3xl px-4 py-16">
    <h2 class="text-2xl font-bold tracking-tight">Pricing FAQ</h2>
    <dl class="mt-8 space-y-6">
      {#each faqs as faq}
        <div>
          <dt class="font-semibold">{faq.question}</dt>
          <dd class="mt-2 text-muted-foreground">{faq.answer}</dd>
        </div>
      {/each}
    </dl>
  </div>
</section>

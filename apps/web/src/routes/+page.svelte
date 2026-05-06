<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { faqPage } from "$lib/seo/jsonld";

  const faqs = [
    {
      question: "What is Shamwari AI?",
      answer:
        "Shamwari AI is an open-source language model and chat platform built by Nyuchi Africa. It is purpose-built for African languages and contexts, with first-class support for English, Shona, and Ndebele, and a deliberate focus on running well on affordable hardware.",
    },
    {
      question: "Which languages does Shamwari AI support?",
      answer:
        "Shamwari AI ships with English, Shona, and Ndebele, with additional Southern African languages on the roadmap. The model is trained on culturally grounded data so it understands idiom, place names, and code-switching that generic models miss.",
    },
    {
      question: "Is Shamwari AI free?",
      answer:
        "Yes. There is a free tier for chat with sensible rate limits, and the model weights and platform code are open source under the MIT licence. Paid tiers cover higher API volume, dashboards, and support for businesses.",
    },
  ];

  const features = [
    {
      title: "Small enough to run locally",
      body: "1B–7B parameters, quantizable for affordable Android devices and modest servers. Run it offline when bandwidth is scarce.",
    },
    {
      title: "Multilingual by design",
      body: "English, Shona, and Ndebele on day one — handling code-switching and idiom that generic models flatten.",
    },
    {
      title: "Open source, end to end",
      body: "Model weights, training code, and platform are MIT-licensed. Audit it, fork it, ship it.",
    },
  ];
</script>

<JsonLd data={faqPage(faqs)} />

<section class="border-b border-border/60">
  <div class="mx-auto max-w-6xl px-4 py-20 text-center md:py-28">
    <p
      class="mb-4 text-sm font-medium uppercase tracking-wide text-muted-foreground"
    >
      By Nyuchi Africa
    </p>
    <h1 class="text-balance text-4xl font-bold tracking-tight md:text-6xl">
      Shamwari AI — open-source AI built for Africa
    </h1>
    <p
      class="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground"
    >
      Small enough to run on the devices people actually use. Multilingual in
      English, Shona, and Ndebele. Culturally grounded, commercially
      sustainable, and fully open source.
    </p>
    <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
      <a
        href="/sign-up?returnTo=%2Fchat"
        class="rounded-md bg-primary px-5 py-2.5 text-primary-foreground hover:opacity-90"
      >
        Try Shamwari free
      </a>
      <a
        href="/docs/quickstart"
        class="rounded-md border border-border px-5 py-2.5 hover:bg-muted"
      >
        Read the quickstart
      </a>
    </div>
  </div>
</section>

<section class="border-b border-border/60">
  <div class="mx-auto max-w-6xl px-4 py-16">
    <h2 class="text-2xl font-bold tracking-tight md:text-3xl">
      What Shamwari does
    </h2>
    <div class="mt-8 grid gap-6 md:grid-cols-3">
      {#each features as feature}
        <div class="rounded-lg border border-border bg-card p-6">
          <h3 class="font-semibold">{feature.title}</h3>
          <p class="mt-2 text-sm text-muted-foreground">{feature.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<section class="border-b border-border/60 bg-muted/30">
  <div class="mx-auto max-w-3xl px-4 py-16">
    <h2 class="text-2xl font-bold tracking-tight md:text-3xl">
      Frequently asked
    </h2>
    <dl class="mt-8 space-y-6">
      {#each faqs as faq}
        <div>
          <dt class="font-semibold">{faq.question}</dt>
          <dd class="mt-2 text-muted-foreground">{faq.answer}</dd>
        </div>
      {/each}
    </dl>
    <p class="mt-8 text-sm">
      <a href="/faq" class="underline underline-offset-4">See all FAQs &rarr;</a>
    </p>
  </div>
</section>

<section>
  <div class="mx-auto max-w-3xl px-4 py-16 text-center">
    <h2 class="text-2xl font-bold tracking-tight md:text-3xl">
      Ready to ship with Shamwari?
    </h2>
    <p class="mt-3 text-muted-foreground">
      Free tier, open weights, real documentation. Built for African builders.
    </p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
      <a
        href="/pricing"
        class="rounded-md bg-primary px-5 py-2.5 text-primary-foreground hover:opacity-90"
      >
        See pricing
      </a>
      <a
        href="https://platform.shamwari.ai"
        class="rounded-md border border-border px-5 py-2.5 hover:bg-muted"
        rel="noopener"
      >
        Get an API key
      </a>
    </div>
  </div>
</section>

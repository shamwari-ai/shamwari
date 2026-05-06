<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb, faqPage } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const faqs = [
    {
      question: "What is Shamwari AI?",
      answer:
        "Shamwari AI is an open-source language model and chat platform built by Nyuchi Africa. It is purpose-built for African languages and contexts, with first-class support for English, Shona, and Ndebele, and a deliberate focus on running well on affordable hardware.",
    },
    {
      question: "Which languages does Shamwari AI support?",
      answer:
        "English, Shona, and Ndebele are first-class today. We are expanding outward across Southern and broader Africa, prioritizing languages with active speaker communities and available training data. Code-switching between English and a local language works.",
    },
    {
      question: "Can I run Shamwari AI locally?",
      answer:
        "Yes. The model targets 1B–7B parameters and ships quantized weights that run on affordable Android devices and modest GPUs. Inference code, weights, and model cards are MIT-licensed on GitHub.",
    },
    {
      question: "Is Shamwari AI open source?",
      answer:
        "Yes. Model weights, training scripts, inference code, and the full platform are MIT-licensed at github.com/nyuchitech/shamwari-ai. Audits, forks, and contributions are welcome.",
    },
    {
      question: "How is Shamwari AI different from ChatGPT?",
      answer:
        "Shamwari is small, local-first, and African by design. ChatGPT is a closed, large, server-side product optimized for English. Shamwari is open weights, runs on the devices Africans actually use, and treats Shona and Ndebele as first-class languages, not afterthoughts.",
    },
    {
      question: "Who owns my data?",
      answer:
        "You do. We do not train on your conversations by default, and you can delete history at any time. The free tier stores chat in CouchDB per-user databases that you can sync or export. See our privacy policy for specifics.",
    },
    {
      question: "Does Shamwari AI work offline?",
      answer:
        "Yes. The local-first design uses PouchDB on the client and CouchDB on the server, so chats sync when you reconnect. With local model weights, basic inference works fully offline on supported devices.",
    },
    {
      question: "How do I get an API key?",
      answer:
        "Sign up at platform.shamwari.ai. New accounts start on the free tier with rate-limited access; upgrade to the Developer tier for $19 per month including 1M tokens.",
    },
    {
      question: "What hardware do I need to self-host?",
      answer:
        "For the 1B model, any modern phone or a CPU-only laptop works at int4 quantization. The 7B model runs comfortably on a single 16 GB GPU or a recent Apple Silicon Mac. Full specs are in the model card.",
    },
    {
      question: "Is Shamwari AI free for non-profits?",
      answer:
        "Yes. Registered non-profits and educational institutions across Africa get the Developer tier at no cost. Email us from your institutional address to enable it.",
    },
  ];

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "FAQ", url: `${SITE.url}/faq` },
  ]);
</script>

<JsonLd data={faqPage(faqs)} />
<JsonLd data={crumbs} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">Frequently asked questions</h1>
  <p class="mt-4 text-lg text-muted-foreground">
    Short, direct answers. If something's missing, ask in chat or open an
    issue on GitHub.
  </p>
  <dl class="mt-12 space-y-8">
    {#each faqs as faq}
      <div>
        <dt class="text-lg font-semibold">{faq.question}</dt>
        <dd class="mt-2 text-muted-foreground">{faq.answer}</dd>
      </div>
    {/each}
  </dl>
</article>

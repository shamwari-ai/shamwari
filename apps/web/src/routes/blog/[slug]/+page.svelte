<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { article, breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";
  import type { PageData } from "./$types";

  const { data }: { data: PageData } = $props();
  const post = $derived(data.post);

  const crumbs = $derived(
    breadcrumb([
      { name: "Home", url: SITE.url },
      { name: "Blog", url: `${SITE.url}/blog` },
      { name: post.title, url: `${SITE.url}/blog/${post.slug}` },
    ]),
  );

  const articleLd = $derived(
    article({
      headline: post.title,
      description: post.description,
      url: `${SITE.url}/blog/${post.slug}`,
      datePublished: post.datePublished,
      dateModified: post.dateModified,
      authorName: post.author.name,
      authorUrl: post.author.url,
    }),
  );
</script>

<JsonLd data={crumbs} />
<JsonLd data={articleLd} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <p class="text-sm text-muted-foreground">
    <a href="/blog" class="underline underline-offset-4">Blog</a> ·
    {new Date(post.datePublished).toLocaleDateString("en", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })} ·
    {post.author.name}
  </p>
  <h1 class="mt-2 text-4xl font-bold tracking-tight">{post.title}</h1>
  <p class="mt-4 text-lg text-muted-foreground">{post.description}</p>

  {#if post.slug === "hello-shamwari"}
    <div class="prose prose-stone mt-10 max-w-none dark:prose-invert">
      <p>
        We are launching <strong>Shamwari AI</strong>: an open-source language
        model and chat platform built by Nyuchi Africa for the African
        continent. The brief is honest — most foundation models assume cheap
        compute, big GPUs, and constant bandwidth. Africa rarely gets all
        three. So we built a small, local-first model with first-class
        support for English, Shona, and Ndebele, and committed the whole
        stack to open source under MIT.
      </p>
      <h2>What ships first</h2>
      <ul>
        <li>1B and 7B model variants, quantizable for affordable Android.</li>
        <li>Free chat at shamwari.ai, rate-limited but usable.</li>
        <li>API access via platform.shamwari.ai for builders.</li>
        <li>Model weights, training code, and inference code on GitHub.</li>
      </ul>
      <h2>What's next</h2>
      <p>
        We're working through expanded language coverage, mobile SDKs, and
        better tooling for fine-tuning on regional corpora. If you build in
        Africa or build for Africa, we'd love your help — issues, PRs, and
        translations are all welcome.
      </p>
      <p>
        — Bryan and the Nyuchi team
      </p>
    </div>
  {/if}
</article>

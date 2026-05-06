<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { ModeWatcher } from "mode-watcher";
  import { JsonLd } from "@shamwari/ui";
  import {
    shamwariOrganization,
    shamwariWebSite,
    shamwariSoftwareApplication,
  } from "$lib/seo/jsonld";
  import { SITE, type PageMeta } from "$lib/seo/meta";
  import Header from "$lib/components/Header.svelte";
  import Footer from "$lib/components/Footer.svelte";

  const { children }: { children: Snippet } = $props();

  const meta = $derived(page.data.meta as PageMeta);
  const orgLd = shamwariOrganization();
  const siteLd = shamwariWebSite();
  const appLd = shamwariSoftwareApplication();
</script>

<svelte:head>
  <title>{meta.title}</title>
  <meta name="description" content={meta.description} />
  <link rel="canonical" href={meta.canonical} />
  {#if meta.noindex}
    <meta name="robots" content="noindex, nofollow" />
  {:else}
    <meta name="robots" content="index, follow, max-image-preview:large" />
  {/if}

  <meta property="og:type" content={meta.ogType} />
  <meta property="og:site_name" content={SITE.name} />
  <meta property="og:locale" content={SITE.locale} />
  <meta property="og:title" content={meta.title} />
  <meta property="og:description" content={meta.description} />
  <meta property="og:url" content={meta.canonical} />
  <meta property="og:image" content={meta.ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content={SITE.twitter} />
  <meta name="twitter:creator" content={SITE.twitter} />
  <meta name="twitter:title" content={meta.title} />
  <meta name="twitter:description" content={meta.description} />
  <meta name="twitter:image" content={meta.ogImage} />

  {#if meta.alternates}
    {#each meta.alternates as alt}
      <link rel="alternate" hreflang={alt.hreflang} href={alt.href} />
    {/each}
  {/if}

  {#if meta.article}
    {#if meta.article.publishedTime}
      <meta
        property="article:published_time"
        content={meta.article.publishedTime}
      />
    {/if}
    {#if meta.article.modifiedTime}
      <meta
        property="article:modified_time"
        content={meta.article.modifiedTime}
      />
    {/if}
    {#if meta.article.author}
      <meta property="article:author" content={meta.article.author} />
    {/if}
    {#if meta.article.section}
      <meta property="article:section" content={meta.article.section} />
    {/if}
    {#if meta.article.tags}
      {#each meta.article.tags as tag}
        <meta property="article:tag" content={tag} />
      {/each}
    {/if}
  {/if}
</svelte:head>

<ModeWatcher defaultMode="system" />
<JsonLd data={orgLd} />
<JsonLd data={siteLd} />
<JsonLd data={appLd} />

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="flex-1">
    {@render children()}
  </main>
  <Footer />
</div>

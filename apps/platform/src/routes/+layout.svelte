<script lang="ts">
  import "../app.css";
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { ModeWatcher } from "mode-watcher";
  import { JsonLd } from "@shamwari/ui";
  import { platformOrganization, platformWebSite } from "$lib/seo/jsonld";
  import { SITE, type PageMeta } from "$lib/seo/meta";
  import Header from "$lib/components/Header.svelte";
  import Footer from "$lib/components/Footer.svelte";

  const { children }: { children: Snippet } = $props();

  const meta = $derived(page.data.meta as PageMeta);
  const orgLd = platformOrganization();
  const siteLd = platformWebSite();
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

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content={SITE.twitter} />
  <meta name="twitter:title" content={meta.title} />
  <meta name="twitter:description" content={meta.description} />
  <meta name="twitter:image" content={meta.ogImage} />
</svelte:head>

<ModeWatcher defaultMode="system" />
<JsonLd data={orgLd} />
<JsonLd data={siteLd} />

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="flex-1">
    {@render children()}
  </main>
  <Footer />
</div>

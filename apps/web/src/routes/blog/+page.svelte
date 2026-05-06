<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";
  import type { PageData } from "./$types";

  const { data }: { data: PageData } = $props();

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Blog", url: `${SITE.url}/blog` },
  ]);
</script>

<JsonLd data={crumbs} />

<section class="mx-auto max-w-3xl px-4 py-16">
  <h1 class="text-4xl font-bold tracking-tight">Shamwari AI blog</h1>
  <p class="mt-4 text-lg text-muted-foreground">
    Releases, technical notes, and field reports from building open-source AI
    for Africa.
  </p>
  <ul class="mt-12 space-y-8">
    {#each data.posts as post}
      <li>
        <a
          href={`/blog/${post.slug}`}
          class="block rounded-lg border border-border bg-card p-6 transition-colors hover:bg-muted"
        >
          <p class="text-sm text-muted-foreground">
            {new Date(post.datePublished).toLocaleDateString("en", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })} · {post.author.name}
          </p>
          <h2 class="mt-1 text-xl font-semibold">{post.title}</h2>
          <p class="mt-2 text-muted-foreground">{post.description}</p>
        </a>
      </li>
    {/each}
  </ul>
</section>

<script lang="ts">
  import type { JsonLdObject } from "./jsonld";

  let { data }: { data: JsonLdObject } = $props();

  const json = $derived(JSON.stringify(data));
</script>

<svelte:head>
  {@html `<script type="application/ld+json">${json}</` + `script>`}
</svelte:head>

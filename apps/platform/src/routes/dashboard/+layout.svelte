<script lang="ts">
  import type { Snippet } from "svelte";

  const { children }: { children: Snippet } = $props();
</script>

<div class="mx-auto max-w-6xl px-4 py-10">
  {@render children()}
</div>

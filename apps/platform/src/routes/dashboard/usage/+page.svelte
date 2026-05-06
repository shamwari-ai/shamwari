<script lang="ts">
  import { goto, invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import type { PageData } from "./$types";

  const { data }: { data: PageData } = $props();

  const ranges = [
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
  ];

  const usage = $derived(data.usage);

  function pctOfLimit(): number {
    if (!usage.tokenLimit) return 0;
    return Math.min(100, Math.round((usage.tokens / usage.tokenLimit) * 100));
  }

  async function changeRange(value: string) {
    const url = new URL(page.url);
    url.searchParams.set("range", value);
    await goto(url.pathname + url.search, { keepFocus: true });
    await invalidateAll();
  }

  function formatNumber(n: number): string {
    return n.toLocaleString();
  }

  // Build a tiny inline bar chart out of the series data so the page
  // shows real shape (not an empty frame) once the backend serves data.
  const maxTokens = $derived(
    usage.series.reduce((m, point) => Math.max(m, point.tokens), 0),
  );
</script>

<div class="flex items-center justify-between">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">Usage</h1>
    <p class="mt-2 text-muted-foreground">
      Tokens, request count, and latency, sliced by key.
    </p>
  </div>
  <label class="text-sm">
    <span class="sr-only">Date range</span>
    <select
      value={usage.range}
      onchange={(e) => changeRange((e.currentTarget as HTMLSelectElement).value)}
      class="rounded-md border border-border bg-background px-3 py-2"
    >
      {#each ranges as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </label>
</div>

<div class="mt-8 grid gap-4 md:grid-cols-3">
  <div class="rounded-lg border border-border bg-card p-6">
    <p class="text-sm text-muted-foreground">Tokens</p>
    <p class="mt-2 text-3xl font-semibold tracking-tight">
      {formatNumber(usage.tokens)}
    </p>
    <p class="mt-1 text-xs text-muted-foreground">
      of {formatNumber(usage.tokenLimit)} ({pctOfLimit()}%)
    </p>
  </div>
  <div class="rounded-lg border border-border bg-card p-6">
    <p class="text-sm text-muted-foreground">Requests</p>
    <p class="mt-2 text-3xl font-semibold tracking-tight">
      {formatNumber(usage.requests)}
    </p>
    <p class="mt-1 text-xs text-muted-foreground">
      p95 latency {usage.p95LatencyMs} ms
    </p>
  </div>
  <div class="rounded-lg border border-border bg-card p-6">
    <p class="text-sm text-muted-foreground">Errors</p>
    <p class="mt-2 text-3xl font-semibold tracking-tight">
      {usage.errorsPercent.toFixed(1)}%
    </p>
    <p class="mt-1 text-xs text-muted-foreground">of total requests</p>
  </div>
</div>

<div class="mt-8 rounded-lg border border-border bg-card p-6">
  <h2 class="font-semibold">Activity</h2>
  {#if usage.series.length === 0}
    <div
      class="mt-6 flex h-48 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground"
    >
      Charts populate once your first request is recorded.
    </div>
  {:else}
    <ul class="mt-6 flex h-48 items-end gap-1">
      {#each usage.series as point}
        <li
          class="flex-1 rounded-t-sm bg-primary/30"
          style:height={`${maxTokens === 0 ? 0 : (point.tokens / maxTokens) * 100}%`}
          title={`${point.date}: ${formatNumber(point.tokens)} tokens, ${formatNumber(point.requests)} requests`}
        ></li>
      {/each}
    </ul>
    <p class="mt-3 text-xs text-muted-foreground">
      {usage.series[0]?.date} → {usage.series[usage.series.length - 1]?.date}
    </p>
  {/if}
</div>

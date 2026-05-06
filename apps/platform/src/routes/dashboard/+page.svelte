<script lang="ts">
  const stats = [
    { label: "Tokens this month", value: "0", help: "Resets on the 1st." },
    { label: "Active API keys", value: "0", help: "Issue your first below." },
    { label: "Plan", value: "Free", help: "Upgrade for higher limits." },
  ];
</script>

<h1 class="text-3xl font-bold tracking-tight">Overview</h1>
<p class="mt-2 text-muted-foreground">
  Welcome to Shamwari AI. The numbers below populate once your first request lands.
</p>

<div class="mt-8 grid gap-4 md:grid-cols-3">
  {#each stats as stat}
    <div class="rounded-lg border border-border bg-card p-6">
      <p class="text-sm text-muted-foreground">{stat.label}</p>
      <p class="mt-2 text-3xl font-semibold tracking-tight">{stat.value}</p>
      <p class="mt-1 text-xs text-muted-foreground">{stat.help}</p>
    </div>
  {/each}
</div>

<section class="mt-12 grid gap-6 md:grid-cols-2">
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Get started</h2>
    <ol class="mt-3 list-decimal space-y-2 pl-6 text-sm text-muted-foreground">
      <li>
        Issue an API key in
        <a href="/dashboard/api-keys" class="underline underline-offset-4"
          >API keys</a
        >.
      </li>
      <li>
        Read the
        <a
          href="https://shamwari.ai/docs/quickstart"
          class="underline underline-offset-4"
          rel="noopener">quickstart</a
        > and send your first request.
      </li>
      <li>
        Watch token usage in
        <a href="/dashboard/usage" class="underline underline-offset-4"
          >Usage</a
        >.
      </li>
    </ol>
  </div>
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Need higher limits?</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Free is rate-limited. Upgrade to Developer ($19/mo, 1M tokens) or
      Business (custom) at any time.
    </p>
    <a
      href="/dashboard/billing"
      class="mt-4 inline-flex rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
    >
      View plans
    </a>
  </div>
</section>

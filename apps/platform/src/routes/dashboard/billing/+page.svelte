<script lang="ts">
  const tiers = [
    {
      name: "Free",
      price: "$0",
      summary: "Rate-limited chat and API for hobby projects.",
      current: true,
    },
    {
      name: "Developer",
      price: "$19/mo",
      summary: "1M tokens included, dashboards, email support.",
      current: false,
    },
    {
      name: "Business",
      price: "Custom",
      summary: "Dedicated capacity, on-prem, language tuning, SLAs.",
      current: false,
    },
  ];
</script>

<h1 class="text-3xl font-bold tracking-tight">Billing</h1>
<p class="mt-2 text-muted-foreground">
  Choose a plan, manage your payment method, and download invoices.
</p>

<div class="mt-8 grid gap-4 md:grid-cols-3">
  {#each tiers as tier}
    <div
      class="rounded-lg border bg-card p-6 {tier.current
        ? 'border-primary'
        : 'border-border'}"
    >
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">{tier.name}</h2>
        {#if tier.current}
          <span
            class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
          >
            Current
          </span>
        {/if}
      </div>
      <p class="mt-2 text-2xl font-bold tracking-tight">{tier.price}</p>
      <p class="mt-2 text-sm text-muted-foreground">{tier.summary}</p>
      {#if !tier.current}
        <button
          class="mt-6 w-full rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          {tier.name === "Business" ? "Talk to sales" : "Upgrade"}
        </button>
      {/if}
    </div>
  {/each}
</div>

<section class="mt-12 grid gap-6 md:grid-cols-2">
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Payment method</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      No card on file. Add one to upgrade beyond the free tier.
    </p>
    <button
      class="mt-4 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
    >
      Add payment method
    </button>
  </div>
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Invoices</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Invoices appear here after your first paid month.
    </p>
  </div>
</section>

<script lang="ts">
  import type { PageData } from "./$types";

  const { data }: { data: PageData } = $props();

  const currentPlanId = $derived(data.subscription?.ordered_item ?? "plan_free");

  function formatPrice(plan: { id: string; price: number }): string {
    if (plan.price === 0) return plan.id === "plan_business" ? "Custom" : "$0";
    return `$${plan.price}/mo`;
  }
</script>

<h1 class="text-3xl font-bold tracking-tight">Billing</h1>
<p class="mt-2 text-muted-foreground">
  Choose a plan, manage your payment method, and download invoices.
</p>

{#if data.plans.length === 0}
  <div
    class="mt-8 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
  >
    Plans aren't available right now. Check back shortly or contact
    <a href="mailto:support@shamwari.ai" class="underline underline-offset-4"
      >support@shamwari.ai</a
    >.
  </div>
{:else}
  <div class="mt-8 grid gap-4 md:grid-cols-3">
    {#each data.plans as plan}
      {@const isCurrent = plan.id === currentPlanId}
      <div
        class="rounded-lg border bg-card p-6 {isCurrent
          ? 'border-primary'
          : 'border-border'}"
      >
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">{plan.name}</h2>
          {#if isCurrent}
            <span
              class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              Current
            </span>
          {/if}
        </div>
        <p class="mt-2 text-2xl font-bold tracking-tight">{formatPrice(plan)}</p>
        <p class="mt-2 text-sm text-muted-foreground">{plan.description}</p>
        <ul class="mt-4 space-y-1 text-xs text-muted-foreground">
          {#each plan.features as feature}
            <li class="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{feature}</span>
            </li>
          {/each}
        </ul>
        {#if !isCurrent}
          <form method="POST" action="?/portal">
            <button
              type="submit"
              class="mt-6 w-full rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              {plan.slug === "business" ? "Talk to sales" : "Upgrade"}
            </button>
          </form>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<section class="mt-12 grid gap-6 md:grid-cols-2">
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Payment method</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Manage your card and billing email through the hosted portal.
    </p>
    <form method="POST" action="?/portal">
      <button
        type="submit"
        class="mt-4 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
      >
        Open billing portal
      </button>
    </form>
  </div>
  <div class="rounded-lg border border-border bg-card p-6">
    <h2 class="font-semibold">Invoices</h2>
    <p class="mt-2 text-sm text-muted-foreground">
      Past invoices appear in the billing portal. We'll surface them
      directly here once we've collected the first paid month.
    </p>
  </div>
</section>

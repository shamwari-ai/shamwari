<section class="border-b border-border/60">
  <div class="mx-auto max-w-3xl px-4 py-20 text-center md:py-28">
    <p
      class="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground"
    >
      Shamwari AI · Developer portal
    </p>
    <h1 class="text-balance text-4xl font-bold tracking-tight md:text-5xl">
      Build with Shamwari AI
    </h1>
    <p
      class="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground"
    >
      Manage API keys, watch usage in real time, and pay for higher limits. The
      same platform powers chat at <a
        href="https://shamwari.ai"
        class="underline underline-offset-4"
        rel="noopener">shamwari.ai</a
      >.
    </p>
    <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
      <a
        href="/sign-up"
        class="rounded-md bg-primary px-5 py-2.5 text-primary-foreground hover:opacity-90"
      >
        Create an account
      </a>
      <a
        href="/sign-in"
        class="rounded-md border border-border px-5 py-2.5 hover:bg-muted"
      >
        Sign in
      </a>
    </div>
  </div>
</section>

<section>
  <div class="mx-auto grid max-w-5xl gap-6 px-4 py-16 md:grid-cols-3">
    {#each [
      { title: "API keys", body: "Issue, rotate, and revoke keys per project. Scope by environment." },
      { title: "Usage dashboards", body: "Per-key token counts, latency, and error rates with alerts." },
      { title: "Billing", body: "Free tier with rate limits, $19/mo for 1M tokens, custom for business." },
    ] as feature}
      <div class="rounded-lg border border-border bg-card p-6">
        <h2 class="font-semibold">{feature.title}</h2>
        <p class="mt-2 text-sm text-muted-foreground">{feature.body}</p>
      </div>
    {/each}
  </div>
</section>

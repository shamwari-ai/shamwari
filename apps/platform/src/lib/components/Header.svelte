<script lang="ts">
  import { page } from "$app/state";

  const user = $derived(page.data.user as { email?: string } | null);
  const authed = $derived(Boolean(user));

  const dashboardNav = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/api-keys", label: "API keys" },
    { href: "/dashboard/usage", label: "Usage" },
    { href: "/dashboard/billing", label: "Billing" },
    { href: "/dashboard/settings", label: "Settings" },
  ];
</script>

<header
  class="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur"
>
  <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
    <div class="flex items-center gap-6">
      <a
        href={authed ? "/dashboard" : "/"}
        class="font-semibold tracking-tight"
      >
        Shamwari Platform
      </a>
      {#if authed}
        <nav class="hidden md:block" aria-label="Dashboard">
          <ul class="flex items-center gap-5 text-sm">
            {#each dashboardNav as item}
              <li>
                <a
                  href={item.href}
                  class="text-muted-foreground transition-colors hover:text-foreground"
                  aria-current={page.url.pathname === item.href
                    ? "page"
                    : undefined}
                >
                  {item.label}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
      {/if}
    </div>
    <div class="flex items-center gap-3 text-sm">
      <a
        href="https://shamwari.ai/docs"
        class="text-muted-foreground hover:text-foreground"
        rel="noopener"
      >
        Docs
      </a>
      {#if authed}
        {#if user?.email}
          <span class="hidden text-muted-foreground md:inline">
            {user.email}
          </span>
        {/if}
        <form method="POST" action="/logout">
          <button class="text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        </form>
      {:else}
        <a
          href="/sign-in"
          class="text-muted-foreground hover:text-foreground"
        >
          Sign in
        </a>
        <a
          href="/sign-up"
          class="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90"
        >
          Get an API key
        </a>
      {/if}
    </div>
  </div>
</header>

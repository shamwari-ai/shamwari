<script lang="ts">
  import { page } from "$app/state";

  const nav = [
    { href: "/", label: "Home" },
    { href: "/about", label: "About" },
    { href: "/pricing", label: "Pricing" },
    { href: "/docs", label: "Docs" },
    { href: "/blog", label: "Blog" },
    { href: "/faq", label: "FAQ" },
  ];

  const user = $derived(page.data.user as { email?: string } | null);
  const authed = $derived(Boolean(user));
</script>

<header
  class="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur"
>
  <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
    <a href="/" class="font-semibold tracking-tight">Shamwari AI</a>
    <nav class="hidden md:block" aria-label="Primary">
      <ul class="flex items-center gap-6 text-sm">
        {#each nav as item}
          <li>
            <a
              href={item.href}
              class="text-muted-foreground transition-colors hover:text-foreground"
              aria-current={page.url.pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>
    <div class="flex items-center gap-3 text-sm">
      <a
        href="https://platform.shamwari.ai"
        class="text-muted-foreground hover:text-foreground"
        rel="noopener"
      >
        Platform
      </a>
      {#if authed}
        <a
          href="/chat"
          class="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90"
        >
          Open chat
        </a>
        <form method="POST" action="/logout">
          <button class="text-muted-foreground hover:text-foreground">
            Sign out
          </button>
        </form>
      {:else}
        <a
          href="/sign-in?returnTo=%2Fchat"
          class="text-muted-foreground hover:text-foreground"
        >
          Sign in
        </a>
        <a
          href="/sign-up?returnTo=%2Fchat"
          class="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:opacity-90"
        >
          Try Shamwari
        </a>
      {/if}
    </div>
  </div>
</header>

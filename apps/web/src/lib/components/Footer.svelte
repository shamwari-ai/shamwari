<script lang="ts">
  const year = new Date().getFullYear();

  const sections = [
    {
      title: "Product",
      links: [
        { href: "/about", label: "About" },
        { href: "/pricing", label: "Pricing" },
        { href: "/faq", label: "FAQ" },
        { href: "/blog", label: "Blog" },
      ],
    },
    {
      title: "Developers",
      links: [
        { href: "/docs", label: "Docs" },
        { href: "/docs/quickstart", label: "Quickstart" },
        { href: "https://platform.shamwari.ai", label: "Platform" },
        { href: "https://github.com/nyuchitech/shamwari-ai", label: "GitHub" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "https://nyuchi.africa", label: "Nyuchi Africa" },
        { href: "/security", label: "Security" },
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
      ],
    },
  ];
</script>

<footer class="border-t border-border/60 bg-background">
  <div class="mx-auto max-w-6xl px-4 py-12">
    <div class="grid grid-cols-2 gap-8 md:grid-cols-4">
      <div class="col-span-2 md:col-span-1">
        <p class="font-semibold tracking-tight">Shamwari AI</p>
        <p class="mt-2 max-w-xs text-sm text-muted-foreground">
          Open-source AI built for Africa. By
          <a href="https://nyuchi.africa" class="underline underline-offset-4"
            >Nyuchi Africa</a
          >.
        </p>
      </div>
      {#each sections as section}
        <div>
          <p class="text-sm font-semibold">{section.title}</p>
          <ul class="mt-3 space-y-2 text-sm">
            {#each section.links as link}
              <li>
                <a
                  href={link.href}
                  class="text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
    <div
      class="mt-10 flex flex-col gap-2 border-t border-border/60 pt-6 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between"
    >
      <p>&copy; {year} Nyuchi Africa. MIT licensed.</p>
      <p>Shamwari means "friend" in Shona.</p>
    </div>
  </div>
</footer>

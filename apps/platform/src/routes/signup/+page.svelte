<script lang="ts">
  let email = $state("");
  let name = $state("");
  let agreed = $state(false);

  function submit(e: Event) {
    e.preventDefault();
    // Auth backend lands in a follow-up commit.
    console.log({ email, name, agreed });
  }
</script>

<section class="mx-auto max-w-md px-4 py-16">
  <h1 class="text-3xl font-bold tracking-tight">Create your account</h1>
  <p class="mt-2 text-muted-foreground">
    Free tier with API access, no credit card required.
  </p>
  <form onsubmit={submit} class="mt-8 space-y-4">
    <div>
      <label for="name" class="block text-sm font-medium">Name</label>
      <input
        id="name"
        type="text"
        required
        bind:value={name}
        autocomplete="name"
        class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
    <div>
      <label for="email" class="block text-sm font-medium">Email</label>
      <input
        id="email"
        type="email"
        required
        bind:value={email}
        autocomplete="email"
        class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" required bind:checked={agreed} class="mt-1" />
      <span class="text-muted-foreground">
        I agree to the
        <a
          href="https://shamwari.ai/terms"
          class="underline underline-offset-4"
          rel="noopener">terms</a
        >
        and
        <a
          href="https://shamwari.ai/privacy"
          class="underline underline-offset-4"
          rel="noopener">privacy policy</a
        >.
      </span>
    </label>
    <button
      type="submit"
      class="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
    >
      Create account
    </button>
    <p class="text-center text-sm text-muted-foreground">
      Already have an account?
      <a href="/login" class="underline underline-offset-4">Sign in</a>
    </p>
  </form>
</section>

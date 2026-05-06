<script lang="ts">
  let email = $state("");
  let sent = $state(false);

  function submit(e: Event) {
    e.preventDefault();
    if (email) sent = true;
  }
</script>

<section class="mx-auto max-w-md px-4 py-16">
  <h1 class="text-3xl font-bold tracking-tight">Recover access</h1>
  <p class="mt-2 text-muted-foreground">
    Enter your account email and we'll send a one-time code.
  </p>
  {#if !sent}
    <form onsubmit={submit} class="mt-8 space-y-4">
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
      <button
        type="submit"
        class="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
      >
        Send recovery code
      </button>
    </form>
  {:else}
    <div class="mt-8 rounded-md border border-border bg-muted p-4 text-sm">
      If an account exists for <strong>{email}</strong>, a one-time code is on
      its way. Check your inbox and spam folder, then return to
      <a href="/login" class="underline underline-offset-4">sign in</a>.
    </div>
  {/if}
</section>

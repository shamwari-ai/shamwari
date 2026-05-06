<script lang="ts">
  let email = $state("");
  let stage = $state<"request" | "verify">("request");
  let code = $state("");

  function requestCode(e: Event) {
    e.preventDefault();
    if (email) stage = "verify";
  }

  function verifyCode(e: Event) {
    e.preventDefault();
    // Auth backend lands in a follow-up commit.
    console.log({ email, code });
  }
</script>

<section class="mx-auto max-w-md px-4 py-16">
  <h1 class="text-3xl font-bold tracking-tight">Sign in</h1>
  <p class="mt-2 text-muted-foreground">
    Enter your email and we'll send you a one-time code.
  </p>

  {#if stage === "request"}
    <form onsubmit={requestCode} class="mt-8 space-y-4">
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
        Send sign-in code
      </button>
      <p class="text-center text-sm text-muted-foreground">
        New here?
        <a href="/signup" class="underline underline-offset-4">Create an account</a>
      </p>
    </form>
  {:else}
    <form onsubmit={verifyCode} class="mt-8 space-y-4">
      <p class="text-sm text-muted-foreground">
        We sent a code to <strong>{email}</strong>. It expires in 10 minutes.
      </p>
      <div>
        <label for="code" class="block text-sm font-medium">Code</label>
        <input
          id="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          bind:value={code}
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <button
        type="submit"
        class="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
      >
        Verify and sign in
      </button>
      <button
        type="button"
        onclick={() => (stage = "request")}
        class="w-full rounded-md border border-border px-4 py-2 hover:bg-muted"
      >
        Use a different email
      </button>
    </form>
  {/if}
</section>

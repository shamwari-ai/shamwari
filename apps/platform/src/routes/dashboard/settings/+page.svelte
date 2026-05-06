<script lang="ts">
  let name = $state("");
  let email = $state("");
  let trainingOptIn = $state(false);

  function save(e: Event) {
    e.preventDefault();
    console.log({ name, email, trainingOptIn });
  }
</script>

<h1 class="text-3xl font-bold tracking-tight">Settings</h1>
<p class="mt-2 text-muted-foreground">
  Profile, security, and data preferences.
</p>

<form
  onsubmit={save}
  class="mt-8 grid gap-6 rounded-lg border border-border bg-card p-6"
>
  <div>
    <h2 class="font-semibold">Profile</h2>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <label class="block text-sm">
        <span class="font-medium">Name</span>
        <input
          type="text"
          bind:value={name}
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
      <label class="block text-sm">
        <span class="font-medium">Email</span>
        <input
          type="email"
          bind:value={email}
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
    </div>
  </div>

  <div class="border-t border-border pt-6">
    <h2 class="font-semibold">Data & training</h2>
    <label class="mt-3 flex items-start gap-2 text-sm">
      <input type="checkbox" bind:checked={trainingOptIn} class="mt-1" />
      <span class="text-muted-foreground">
        Allow Shamwari AI to use my conversations to improve future model
        versions. Off by default. You can revoke at any time.
      </span>
    </label>
  </div>

  <div class="flex justify-end border-t border-border pt-6">
    <button
      type="submit"
      class="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
    >
      Save changes
    </button>
  </div>
</form>

<section class="mt-8 rounded-lg border border-destructive/40 bg-card p-6">
  <h2 class="font-semibold text-destructive">Danger zone</h2>
  <p class="mt-2 text-sm text-muted-foreground">
    Delete your account and all associated data. This cannot be undone.
  </p>
  <button
    class="mt-4 rounded-md border border-destructive px-4 py-2 text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground"
  >
    Delete account
  </button>
</section>

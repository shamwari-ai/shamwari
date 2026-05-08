<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";

  const { data, form }: { data: PageData; form: ActionData | null } = $props();

  const profile = $derived(data.profile);

  let name = $state(profile.name);
  let language = $state(profile.preferences.language ?? "en");
  let theme = $state<"light" | "dark" | "system">(
    profile.preferences.theme ?? "system",
  );
  let trainingOptIn = $state(false);
</script>

<h1 class="text-3xl font-bold tracking-tight">Settings</h1>
<p class="mt-2 text-muted-foreground">Profile, security, and data preferences.</p>

{#if form && "saved" in form && form.saved}
  <p
    class="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-primary"
    role="status"
  >
    Saved.
  </p>
{:else if form && "error" in form && form.error}
  <p class="mt-4 text-sm text-destructive" role="alert">{form.error}</p>
{/if}

<form
  method="POST"
  action="?/save"
  use:enhance
  class="mt-8 grid gap-6 rounded-lg border border-border bg-card p-6"
>
  <div>
    <h2 class="font-semibold">Profile</h2>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <label class="block text-sm">
        <span class="font-medium">Name</span>
        <input
          name="name"
          type="text"
          bind:value={name}
          required
          maxlength="120"
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        />
      </label>
      <div class="block text-sm">
        <span class="font-medium">Email</span>
        <input
          type="email"
          value={profile.email}
          readonly
          class="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground"
        />
        <span class="mt-1 block text-xs text-muted-foreground">
          Email is managed by your sign-in provider.
        </span>
      </div>
    </div>
  </div>

  <div class="border-t border-border pt-6">
    <h2 class="font-semibold">Preferences</h2>
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <label class="block text-sm">
        <span class="font-medium">Language</span>
        <select
          name="language"
          bind:value={language}
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        >
          <option value="en">English</option>
          <option value="sn">Shona</option>
          <option value="nd">Ndebele</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="font-medium">Theme</span>
        <select
          name="theme"
          bind:value={theme}
          class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </div>
  </div>

  <div class="border-t border-border pt-6">
    <h2 class="font-semibold">Data & training</h2>
    <label class="mt-3 flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        name="training_opt_in"
        bind:checked={trainingOptIn}
        class="mt-1"
      />
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
  <form method="POST" action="?/portal">
    <button
      formaction="/dashboard/billing?/portal"
      class="mt-4 rounded-md border border-destructive px-4 py-2 text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground"
    >
      Delete account
    </button>
  </form>
</section>

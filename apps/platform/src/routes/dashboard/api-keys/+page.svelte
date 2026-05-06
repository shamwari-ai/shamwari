<script lang="ts">
  import { enhance } from "$app/forms";
  import type { ActionData, PageData } from "./$types";

  const {
    data,
    form,
  }: { data: PageData; form: ActionData | null } = $props();

  let label = $state("");
  let confirmingRevoke = $state<string | null>(null);

  // Pull the freshly-minted secret out of the action result for one render.
  const justCreated = $derived(
    form && "created" in form ? form.created : null,
  );

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
    } catch {
      /* noop — modern browsers may block clipboard outside HTTPS */
    }
  }
</script>

<h1 class="text-3xl font-bold tracking-tight">API keys</h1>
<p class="mt-2 text-muted-foreground">
  One key per environment is the safest pattern. Keys are shown once at
  creation; we hash and store only the prefix.
</p>

{#if justCreated}
  <div
    class="mt-6 rounded-lg border border-primary bg-primary/5 p-4"
    role="status"
  >
    <p class="text-sm font-semibold">
      Key issued — copy it now. We won't show it again.
    </p>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      <code
        class="block flex-1 break-all rounded-md bg-background px-3 py-2 font-mono text-sm"
        >{justCreated.secret}</code
      >
      <button
        type="button"
        onclick={() => copySecret(justCreated.secret)}
        class="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
      >
        Copy
      </button>
    </div>
  </div>
{/if}

{#if form && "error" in form && form.error}
  <p class="mt-4 text-sm text-destructive" role="alert">{form.error}</p>
{/if}

<form
  method="POST"
  action="?/create"
  use:enhance
  class="mt-8 flex gap-3 rounded-lg border border-border bg-card p-4"
>
  <label class="flex-1">
    <span class="block text-sm font-medium">Key label</span>
    <input
      name="label"
      type="text"
      bind:value={label}
      placeholder="e.g. production-web"
      maxlength="64"
      required
      class="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
    />
  </label>
  <button
    type="submit"
    class="self-end rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
  >
    Issue key
  </button>
</form>

<div class="mt-8 overflow-hidden rounded-lg border border-border">
  <table class="w-full text-sm">
    <thead class="bg-muted text-left">
      <tr>
        <th class="px-4 py-2 font-medium">Label</th>
        <th class="px-4 py-2 font-medium">Key prefix</th>
        <th class="px-4 py-2 font-medium">Created</th>
        <th class="px-4 py-2 font-medium">Last used</th>
        <th class="px-4 py-2"></th>
      </tr>
    </thead>
    <tbody>
      {#each data.keys as key (key.id)}
        <tr class="border-t border-border">
          <td class="px-4 py-3">{key.label}</td>
          <td class="px-4 py-3 font-mono text-xs">{key.prefix}…</td>
          <td class="px-4 py-3 text-muted-foreground">
            {new Date(key.createdAt).toLocaleDateString()}
          </td>
          <td class="px-4 py-3 text-muted-foreground">
            {key.lastUsedAt
              ? new Date(key.lastUsedAt).toLocaleString()
              : "Never"}
          </td>
          <td class="px-4 py-3 text-right">
            {#if confirmingRevoke === key.id}
              <form method="POST" action="?/revoke" use:enhance class="inline">
                <input type="hidden" name="id" value={key.id} />
                <button
                  type="submit"
                  class="text-sm font-medium text-destructive hover:underline"
                >
                  Confirm revoke
                </button>
                <button
                  type="button"
                  onclick={() => (confirmingRevoke = null)}
                  class="ml-2 text-sm text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </form>
            {:else}
              <button
                type="button"
                onclick={() => (confirmingRevoke = key.id)}
                class="text-sm text-destructive hover:underline"
              >
                Revoke
              </button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="5" class="px-4 py-10 text-center text-muted-foreground">
            No keys yet. Issue your first key above.
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

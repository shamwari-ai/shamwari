<script lang="ts">
  let prompt = $state("");
  let messages = $state<{ role: "user" | "assistant"; text: string }[]>([
    {
      role: "assistant",
      text:
        "Mhoro! I'm Shamwari. Ask me anything in English, Shona, or Ndebele. The chat backend lands in a follow-up commit — this view is the shell.",
    },
  ]);

  function send(event: Event) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text) return;
    messages = [
      ...messages,
      { role: "user", text },
      {
        role: "assistant",
        text: "Backend not wired up yet — coming in the next PR.",
      },
    ];
    prompt = "";
  }
</script>

<section class="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl flex-col px-4">
  <div class="flex-1 space-y-4 overflow-y-auto py-6">
    {#each messages as message}
      <div
        class="rounded-lg p-4 {message.role === 'user'
          ? 'ml-auto max-w-md bg-primary text-primary-foreground'
          : 'mr-auto max-w-xl bg-muted text-foreground'}"
      >
        {message.text}
      </div>
    {/each}
  </div>
  <form
    onsubmit={send}
    class="flex items-end gap-2 border-t border-border/60 py-4"
  >
    <label for="prompt" class="sr-only">Message Shamwari</label>
    <textarea
      id="prompt"
      bind:value={prompt}
      rows="2"
      placeholder="Ask Shamwari anything…"
      class="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
    ></textarea>
    <button
      type="submit"
      class="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
    >
      Send
    </button>
  </form>
</section>

<script lang="ts">
  import { page } from "$app/state";
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-4">
  {#if page.status === 404}
    <h1 class="text-4xl font-bold">404</h1>
    <p class="text-muted-foreground">Page not found.</p>
    <a href="/" class="text-primary underline underline-offset-4">Go home</a>
  {:else}
    <h1 class="text-4xl font-bold">Something went wrong</h1>
    <p class="text-muted-foreground">
      {page.error?.message ?? "An unexpected error occurred."}
    </p>
    <a href="/" class="text-primary underline underline-offset-4">Go home</a>
  {/if}
</div>

<script lang="ts">
  import { JsonLd } from "@shamwari/ui";
  import { breadcrumb, techArticle } from "$lib/seo/jsonld";
  import { SITE } from "$lib/seo/meta";

  const url = `${SITE.url}/docs/quickstart`;

  const crumbs = breadcrumb([
    { name: "Home", url: SITE.url },
    { name: "Docs", url: `${SITE.url}/docs` },
    { name: "Quickstart", url },
  ]);

  const articleLd = techArticle({
    headline: "Shamwari AI Quickstart",
    description:
      "Send your first chat completion against the Shamwari AI API in under five minutes.",
    url,
    datePublished: "2026-05-06",
    proficiencyLevel: "Beginner",
  });
</script>

<JsonLd data={crumbs} />
<JsonLd data={articleLd} />

<article class="mx-auto max-w-3xl px-4 py-16">
  <p class="text-sm text-muted-foreground">
    <a href="/docs" class="underline underline-offset-4">Docs</a> / Quickstart
  </p>
  <h1 class="mt-2 text-4xl font-bold tracking-tight">Quickstart</h1>
  <p class="mt-4 text-lg text-muted-foreground">
    Send your first chat completion in under five minutes. You'll need an API
    key from <a
      href="https://platform.shamwari.ai"
      class="underline underline-offset-4"
      rel="noopener">platform.shamwari.ai</a
    > and Node.js 20 or Python 3.11.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">1. Get an API key</h2>
  <p class="mt-3 text-muted-foreground">
    Sign in at platform.shamwari.ai, create a project, and copy the key. The
    free tier is rate-limited but works for the quickstart.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">2. Install the client</h2>
  <pre class="mt-3 overflow-x-auto rounded-md bg-muted p-4 text-sm"><code
      >npm install @shamwari/sdk
# or
pip install shamwari</code></pre>

  <h2 class="mt-10 text-2xl font-semibold">3. Send a chat completion</h2>
  <pre class="mt-3 overflow-x-auto rounded-md bg-muted p-4 text-sm"><code
      >{`import { Shamwari } from "@shamwari/sdk";

const client = new Shamwari({ apiKey: process.env.SHAMWARI_API_KEY });

const reply = await client.chat.completions.create({
  model: "shamwari-7b",
  messages: [
    { role: "system", content: "You answer in Shona." },
    { role: "user", content: "Mhoro, makadii?" },
  ],
});

console.log(reply.choices[0].message.content);`}</code></pre>

  <h2 class="mt-10 text-2xl font-semibold">4. Try it in another language</h2>
  <p class="mt-3 text-muted-foreground">
    Swap the system prompt to <code>"You answer in isiNdebele."</code> and
    the same model handles it. Code-switching between English and a local
    language also works in the same conversation.
  </p>

  <h2 class="mt-10 text-2xl font-semibold">Next steps</h2>
  <ul class="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
    <li>Browse the full <a href="/docs" class="underline underline-offset-4">developer docs</a>.</li>
    <li>Read the <a href="/docs/models" class="underline underline-offset-4">model cards</a> to pick the right size for your hardware.</li>
    <li>Set up usage alerts in the platform dashboard.</li>
  </ul>
</article>

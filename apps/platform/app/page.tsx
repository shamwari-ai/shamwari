import {
  JsonLd,
  buildSoftwareApplication,
} from "@shamwari/ui/lib/jsonld";

const shamwariApi = buildSoftwareApplication({
  name: "Shamwari AI API",
  url: "https://platform.shamwari.ai",
  description:
    "API for AI inference, embeddings, and language processing — purpose-built for African languages and contexts.",
  applicationCategory: "DeveloperApplication",
  inLanguage: ["en", "sn", "nd"],
  provider: { name: "Nyuchi Africa", url: "https://nyuchi.africa" },
  offers: [
    {
      name: "Free",
      price: "0",
      priceCurrency: "USD",
      description: "10,000 tokens/month for experimentation",
    },
    {
      name: "Starter",
      price: "9.99",
      priceCurrency: "USD",
      description: "100,000 tokens/month for small projects",
    },
    {
      name: "Pro",
      price: "49.99",
      priceCurrency: "USD",
      description: "1,000,000 tokens/month for production workloads",
    },
  ],
});

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <JsonLd data={shamwariApi} />
      <main className="flex max-w-2xl flex-col items-center gap-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          Shamwari AI Platform
        </h1>
        <p className="text-lg text-muted-foreground">
          Developer and business portal — API keys, usage dashboards, billing,
          and documentation.
        </p>
      </main>
    </div>
  );
}

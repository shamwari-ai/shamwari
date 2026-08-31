import { defineCollection } from 'astro:content';
import { z } from 'astro:schema';
import { glob } from 'astro/loaders';

// The nav order is data, not a hand-maintained list in the layout: adding a
// page means adding a file with an `order`, and nothing else.
const docs = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    /** Sidebar label, when the page title is too long for it. */
    nav: z.string().optional(),
    /** One sentence. Used as the meta description. */
    summary: z.string(),
    order: z.number(),
  }),
});

export const collections = { docs };

/**
 * Blog post registry. Used by /blog index, /rss.xml, and the slug page.
 * In production replace this with mdsvex or a CMS — registry shape stays.
 */

export interface PostMeta {
  slug: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  author: { name: string; url?: string };
  tags?: string[];
}

export const posts: PostMeta[] = [
  {
    slug: "hello-shamwari",
    title: "Introducing Shamwari AI",
    description:
      "Why we are building open-source AI for Africa, what ships first, and how to get involved.",
    datePublished: "2026-05-06",
    author: {
      name: "Bryan Fawcett",
      url: "https://nyuchi.africa",
    },
    tags: ["launch", "open-source", "africa"],
  },
];

export function getPost(slug: string): PostMeta | undefined {
  return posts.find((post) => post.slug === slug);
}

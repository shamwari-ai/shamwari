import { error } from "@sveltejs/kit";
import { buildMeta } from "$lib/seo/meta";
import { getPost } from "../posts";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ params, url }) => {
  const post = getPost(params.slug);
  if (!post) {
    throw error(404, "Post not found");
  }
  return {
    post,
    meta: buildMeta({
      pathname: url.pathname,
      title: post.title,
      description: post.description,
      ogType: "article",
      article: {
        publishedTime: post.datePublished,
        modifiedTime: post.dateModified,
        author: post.author.name,
        section: "Blog",
        tags: post.tags,
      },
    }),
  };
};

import { ogImage, ogSize } from "@/lib/og";
import { getAllPosts, getPost, orPlaceholder, topicName } from "@/lib/posts";

export const dynamic = "force-static";
export const dynamicParams = false;
export const size = ogSize;
export const contentType = "image/png";
export const alt = "Article preview";

export function generateStaticParams() {
  return orPlaceholder(
    "slug",
    getAllPosts().map((p) => p.slug),
  );
}

export default function Image({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  return ogImage({
    eyebrow: post?.tags[0] ? topicName(post.tags[0]) : "Blog",
    title: post?.title ?? "rajib.uk",
  });
}

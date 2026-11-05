import { notFound } from "next/navigation";
import { pageMarkdown } from "@/lib/llms";
import { markdownSlug } from "@/lib/paths";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/llms.mdx/[[...slug]]">) {
  const { slug = [] } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();
  return new Response(await pageMarkdown(page), { headers: { "Content-Type": "text/markdown" } });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: markdownSlug(page.slugs) }));
}

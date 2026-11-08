import { flattenTree } from "fumadocs-core/page-tree";
import { sourceMarkdown } from "./layout";
import { docsUrl, markdownUrl } from "./paths";
import { source } from "./source";

type Page = NonNullable<ReturnType<typeof source.getPage>>;

function absolute(href: string, page: Page): string {
  if (/^[a-z]+:/i.test(href)) return href;
  return docsUrl(href.startsWith("#") ? `${page.url}${href}` : source.resolveHref(href, page));
}

export async function pageMarkdown(page: Page): Promise<string> {
  const body = (await page.data.getText("processed"))
    .replaceAll("<Source />", sourceMarkdown)
    .replace(/\]\(([^)\s]+)\)/g, (_, href: string) => `](${absolute(href, page)})`)
    .replace(/href="([^"]+)"/g, (_, href: string) => `href="${absolute(href, page)}"`);
  return `# ${page.data.title} (${docsUrl(page.url)})\n\n${body}`;
}

export function index(): string {
  const pages = flattenTree(source.getPageTree().children).flatMap((node) => source.getNodePage(node) ?? []);
  const lines = pages.map((page) => `- [${page.data.title}](${markdownUrl(page.slugs)}): ${page.data.description ?? ""}`);
  return `# Endline\n\n> Crypto options on NEAR Intents.\n\n${lines.join("\n")}\n`;
}

export async function full(): Promise<string> {
  const pages = await Promise.all(source.getPages().map(pageMarkdown));
  return pages.join("\n\n");
}

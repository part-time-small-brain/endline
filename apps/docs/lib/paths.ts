export const basePath = process.env.DOCS_BASE_PATH ?? "";

export function docsUrl(path: string): string {
  return `${basePath}${path}`.replace(/\/(?=#|$)/, "") || "/";
}

export function markdownSlug(slugs: string[]): string[] {
  return [...slugs, "content.md"];
}

export function markdownUrl(slugs: string[]): string {
  return `${basePath}/llms.mdx/${markdownSlug(slugs).join("/")}`;
}

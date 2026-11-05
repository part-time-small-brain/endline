export function docsUrl(path: string): string {
  return path.replace(/\/(?=#|$)/, "") || "/";
}

export function markdownSlug(slugs: string[]): string[] {
  return [...slugs, "content.md"];
}

export function markdownUrl(slugs: string[]): string {
  return `/llms.mdx/${markdownSlug(slugs).join("/")}`;
}

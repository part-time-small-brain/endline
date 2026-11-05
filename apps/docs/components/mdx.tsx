import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { sourceUrl } from "@/lib/layout";

function Source() {
  return sourceUrl ? <>Source: <a href={sourceUrl}>GitHub</a></> : <>Source: coming soon</>;
}

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Source, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

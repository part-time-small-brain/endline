import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import { sourceUrl } from "@/lib/layout";

function Source() {
  return <>Source: <a href={sourceUrl}>GitHub</a></>;
}

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Source, ...components } satisfies MDXComponents;
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}

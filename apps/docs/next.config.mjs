import { createMDX } from "fumadocs-mdx/next";

const basePath = process.env.DOCS_BASE_PATH ?? "/docs";

export default createMDX()({
  output: "export",
  basePath,
  env: { DOCS_BASE_PATH: basePath },
  reactStrictMode: true,
  agentRules: false,
});

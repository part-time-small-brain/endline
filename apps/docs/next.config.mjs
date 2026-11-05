import { createMDX } from "fumadocs-mdx/next";

export default createMDX()({
  output: "export",
  reactStrictMode: true,
  agentRules: false,
});

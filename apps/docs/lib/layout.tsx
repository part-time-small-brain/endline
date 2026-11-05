import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const sourceUrl = "https://github.com/part-time-small-brain/endline";

export const sourceMarkdown = `Source: [GitHub](${sourceUrl})`;

function Wordmark() {
  return (
    <span className="wordmark">
      <svg width={24} height={20} viewBox="0 0 48 40" fill="none" strokeWidth={3} strokeLinecap="square" aria-hidden="true">
        <path d="M3 11V3h8M37 3h8v8M45 29v8h-8M11 37H3v-8" stroke="currentColor" />
        <path d="M10 20h14" stroke="var(--up)" strokeWidth={4} />
        <path d="M24 20h14" stroke="var(--down)" strokeWidth={4} />
      </svg>
      endline
    </span>
  );
}

export const baseOptions: BaseLayoutProps = {
  nav: { title: <Wordmark /> },
  githubUrl: sourceUrl,
  themeSwitch: { mode: "light-dark-system" },
  links: [
    {
      type: "custom",
      children: (
        <a href="https://app.endline.trade" className="open-app">
          Open app
        </a>
      ),
    },
  ],
};

import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const sourceUrl: string | undefined = undefined;

export const sourceMarkdown = sourceUrl ? `Source: [GitHub](${sourceUrl})` : "Source: coming soon";

function Wordmark() {
  return (
    <span className="wordmark" aria-label="Endline">
      <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12a7 7 0 0 1 14 0z" fill="var(--up)" />
        <path d="M5 12a7 7 0 0 0 14 0z" fill="var(--down)" />
        <rect x="1" y="11" width="22" height="2" rx="1" fill="currentColor" />
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
        <a href="/app" className="open-app">
          Open app
        </a>
      ),
    },
  ],
};

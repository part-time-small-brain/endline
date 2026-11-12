import { useApp } from "../../app/context.ts";
import { Link } from "../../app/router.tsx";
import { Wordmark } from "../Glyphs.tsx";
import { ThemeToggle } from "../ThemeToggle.tsx";
import { jump } from "./jump.ts";

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "safety", label: "Safety" },
  { id: "faq", label: "FAQ" },
];

const LINK = "inline-flex h-11 items-center px-1 font-mono text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-ink-2 uppercase transition-colors duration-150 hover:text-ink";

export function Nav() {
  const { paths } = useApp().config;
  return (
    <header id="top" className="flex items-center justify-between gap-3 border-b border-rule px-4 py-1.5 sm:min-h-16 sm:px-6 sm:py-0">
      <div className="flex items-center gap-7">
        <a href="#top" onClick={jump} aria-label="Endline, back to top" className="rounded-lg">
          <Wordmark />
        </a>
        <nav aria-label="Main" className="flex gap-4 max-[374px]:hidden">
          {SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} onClick={jump} className={`${LINK} max-lg:hidden`}>
              {label}
            </a>
          ))}
          <a href="/docs" className={LINK}>
            Docs
          </a>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href={paths.trade}
          className="inline-flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-semibold whitespace-nowrap text-on-ink transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}

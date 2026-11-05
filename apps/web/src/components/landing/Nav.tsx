import { Link } from "../../app/router.tsx";
import { PATHS } from "../../lib/route.ts";
import { Wordmark } from "../Glyphs.tsx";
import { ThemeSwitch } from "../ThemeSwitch.tsx";
import { jump } from "./jump.ts";

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "safety", label: "Safety" },
  { id: "faq", label: "FAQ" },
];

const LINK = "hidden h-10 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:bg-ink/5 hover:text-ink lg:inline-flex";

export function Nav() {
  return (
    <nav
      aria-label="Main"
      className="fixed top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface/75 p-1 pl-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_8px_24px_rgb(14_20_32/0.08)] ring-1 ring-ink/5 backdrop-blur-xl backdrop-saturate-150 lg:top-6"
    >
      <a href="#top" onClick={jump} aria-label="Endline, back to top" className="mr-2 rounded-lg lg:mr-4">
        <Wordmark />
      </a>
      {SECTIONS.map(({ id, label }) => (
        <a key={id} href={`#${id}`} onClick={jump} className={LINK}>
          {label}
        </a>
      ))}
      <a href="/docs" className={LINK}>
        Docs
      </a>
      <div className="mx-2 hidden lg:block">
        <ThemeSwitch />
      </div>
      <Link
        href={PATHS.trade}
        className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold whitespace-nowrap text-on-ink transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
      >
        Open app
      </Link>
    </nav>
  );
}

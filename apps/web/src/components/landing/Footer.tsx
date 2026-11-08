import { useApp } from "../../app/context.ts";
import { Link } from "../../app/router.tsx";
import { Wordmark } from "../Glyphs.tsx";

const LINK = "inline-flex h-11 items-center font-mono text-xs font-semibold tracking-[0.06em] text-ink-2 uppercase transition-colors duration-150 hover:text-ink";

export function Footer() {
  const { paths } = useApp().config;
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto max-w-7xl px-4 pt-6 pb-8 lg:px-12">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <Wordmark />
          <nav aria-label="Footer" className="flex items-center gap-6 sm:ml-auto">
            <Link href={paths.trade} className={LINK}>
              App
            </Link>
            <a href="/docs" className={LINK}>
              Docs
            </a>
            <a href="https://github.com/part-time-small-brain/endline" className={LINK}>
              GitHub
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

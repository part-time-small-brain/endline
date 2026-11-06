import { useApp } from "../../app/context.ts";
import { Link } from "../../app/router.tsx";
import { Wordmark } from "../Glyphs.tsx";

const LINK = "text-ink-2 transition-colors duration-150 hover:text-ink";

export function Footer() {
  const { paths } = useApp().config;
  return (
    <footer className="mx-auto max-w-7xl px-4 pt-12 pb-8 lg:px-12">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Wordmark />
        <nav aria-label="Footer" className="flex items-center gap-6 text-sm sm:ml-auto">
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
      <div className="mt-8 flex flex-col gap-2 pt-6 text-xs text-ink-2 shadow-[0_-1.5px_0_var(--rule)] sm:flex-row sm:justify-between">
        <p>
          You can lose what you pay. The contract isn't audited, and the owner controls the price oracle. Not financial advice.{" "}
          <a href="/docs/safety-and-risks" className="font-semibold text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
            Safety and risks
          </a>
        </p>
        <p>Built on NEAR Intents</p>
      </div>
    </footer>
  );
}

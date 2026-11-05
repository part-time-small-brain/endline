import { m } from "motion/react";
import { useApp } from "../../app/context.ts";
import { Link } from "../../app/router.tsx";
import { EASE_DRAWER } from "./motion.ts";

export function FinalCta() {
  const { paths } = useApp().config;
  return (
    <section aria-label="Get started" className="relative grid h-[440px] grid-rows-2 overflow-hidden lg:h-[560px]">
      <div className="flex items-end bg-page text-ink">
        <h2 className="mx-auto w-full max-w-7xl px-4 pb-1 text-5xl leading-none font-semibold tracking-[-0.04em] lg:px-12 lg:pb-2 lg:text-8xl">Draw your first line.</h2>
      </div>
      <div className="bg-page">
        <div className="mx-auto max-w-7xl px-4 pt-10 lg:px-12">
          <Link
            href={paths.trade}
            className="inline-flex h-14 items-center rounded-2xl bg-ink px-6 font-semibold text-on-ink transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
          >
            Start trading
          </Link>
        </div>
      </div>
      <m.div
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 origin-left bg-[linear-gradient(to_right,var(--up)_50%,var(--down)_50%)]"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.1, ease: EASE_DRAWER }}
      />
    </section>
  );
}

import type { OptionKind } from "@endline/sdk";
import { Scales } from "@phosphor-icons/react";
import { m, useReducedMotion, useSpring } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Link } from "../../app/router.tsx";
import { PATHS } from "../../lib/route.ts";
import { HeroWidget, PLOT_HEIGHT } from "./HeroWidget.tsx";
import { jump } from "./jump.ts";
import { EASE_DRAWER, EASE_OUT, SPRING } from "./motion.ts";
import type { DemoMarket } from "./useDemoMarket.ts";

const LINES = [
  ["Pick", "a", "side"],
  ["of", "the", "line."],
];
const SIDE_BY_SIDE = "(min-width: 1024px)";
const BASELINE_ABOVE_BOTTOM = 8;
const SEAT_RANGE = [-32, 160] as const;

const offsetIn = (element: HTMLElement, ancestor: HTMLElement) => {
  let top = 0;
  for (let node: Element | null = element; node instanceof HTMLElement && node !== ancestor; node = node.offsetParent) top += node.offsetTop;
  return top;
};

export function Hero({ market, nowSec }: { market: DemoMarket | undefined; nowSec: number }) {
  const [kind, setKind] = useState<OptionKind>("call");
  const [lineY, setLineY] = useState(PLOT_HEIGHT / 2);
  const [box, setBox] = useState<{ plot: number; title: number; sideBySide: boolean }>();
  const [pinned, setPinned] = useState<number>();
  const hero = useRef<HTMLElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const seat = useSpring(0, SPRING);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const section = hero.current;
    if (!section) return;
    const measure = () => {
      if (!plot.current || !title.current) return;
      setBox({ plot: offsetIn(plot.current, section), title: offsetIn(title.current, section) + title.current.offsetHeight, sideBySide: matchMedia(SIDE_BY_SIDE).matches });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, []);

  const horizon = box && box.plot + lineY;
  const seatTo = box?.sideBySide && horizon !== undefined ? Math.min(Math.max((pinned ?? horizon) - box.title + BASELINE_ABOVE_BOTTOM, SEAT_RANGE[0]), SEAT_RANGE[1]) : 0;

  useLayoutEffect(() => {
    if (!box) return;
    if (placed.current && !reduce) seat.set(seatTo);
    else seat.jump(seatTo);
    placed.current = true;
  }, [box, seatTo, reduce, seat]);

  const up = kind === "call";
  const pin = () => setPinned((value) => value ?? horizon);

  return (
    <section ref={hero} id="top" data-side={up ? "up" : "down"} className="relative overflow-hidden">
      {horizon !== undefined && (
        <m.div aria-hidden="true" className="absolute inset-x-0 top-0 h-full" initial={false} animate={{ y: horizon }} transition={SPRING}>
          <div className={`absolute inset-x-0 bottom-full h-full transition-colors duration-300 [mask-image:linear-gradient(to_top,#000,rgb(0_0_0/var(--glow-far)))] ${up ? "bg-up-glow" : "bg-up-glow-soft"}`} />
          <div className={`absolute inset-0 transition-colors duration-300 [mask-image:linear-gradient(#000,rgb(0_0_0/var(--glow-far)))] ${up ? "bg-down-glow-soft" : "bg-down-glow"}`} />
          <m.div
            className="absolute inset-x-0 -top-px h-[2.5px] origin-left bg-ink"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.1, ease: EASE_DRAWER, delay: 0.15 }}
          />
        </m.div>
      )}

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pt-24 pb-12 lg:grid-cols-[minmax(0,1fr)_584px] lg:items-start lg:gap-12 lg:px-12 lg:pt-32 lg:pb-16">
        <m.div style={{ y: seat }} className="lg:pt-6">
          <h1 ref={title} className="text-5xl leading-none font-semibold tracking-[-0.035em] xl:text-7xl">
            {LINES.map((words, line) => (
              <span key={line} className="block">
                {words.map((word, i) => (
                  <m.span
                    key={word}
                    className="mr-[0.24em] inline-block last:mr-0"
                    initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.08 + (line * 3 + i) * 0.07 }}
                  >
                    {word}
                  </m.span>
                ))}
              </span>
            ))}
          </h1>
          <Rise delay={0.3}>
            <p className="mt-6 max-w-[520px] text-base lg:text-xl">
              Call whether Bitcoin or Ethereum ends above or below your price. The most you can lose is what you pay.
            </p>
          </Rise>
          <Rise delay={0.42}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={PATHS.trade}
                className="inline-flex h-14 items-center rounded-2xl bg-ink px-6 font-semibold text-on-ink transition-[transform,opacity] duration-150 ease-out hover:opacity-90 active:scale-[0.97]"
              >
                Start trading
              </Link>
              <a
                href="#how"
                onClick={jump}
                className="inline-flex h-14 items-center rounded-2xl px-6 font-semibold shadow-[inset_0_0_0_2px_var(--ink)] transition-[transform,background-color] duration-150 ease-out hover:bg-ink/5 active:scale-[0.97]"
              >
                How it works
              </a>
            </div>
          </Rise>
          <Rise delay={0.54}>
            <p className="mt-8 flex items-center gap-3 text-sm font-semibold">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-on-ink" aria-hidden="true">
                <Scales size={20} />
              </span>
              Final price: median of 7 major exchanges
            </p>
          </Rise>
        </m.div>

        <Rise delay={0.25}>
          <div onPointerDownCapture={pin} onKeyDownCapture={pin}>
            <HeroWidget market={market} nowSec={nowSec} kind={kind} onKind={setKind} onLine={setLineY} plotRef={plot} />
          </div>
        </Rise>
      </div>
    </section>
  );
}

function Rise({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  return (
    <m.div initial={{ opacity: 0, y: 24, filter: "blur(8px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.9, ease: EASE_OUT, delay }}>
      {children}
    </m.div>
  );
}

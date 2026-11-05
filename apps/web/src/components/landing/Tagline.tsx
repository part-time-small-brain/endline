import { useEffect, useRef, useState } from "react";

const WORDS = "You choose the line and the side. If you are wrong, you lose what you paid. If you are right, the further the price runs, the more you get, up to the cap.".split(" ");
const TRIGGER = 0.62;

export function Tagline() {
  const text = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = text.current?.getBoundingClientRect();
      if (!box) return;
      const progress = (innerHeight * TRIGGER - box.top) / box.height;
      const reached = Math.round(Math.min(Math.max(progress, 0), 1) * WORDS.length);
      setLit((lit) => Math.max(lit, reached));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    return () => {
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section aria-label="The idea" className="mx-auto max-w-7xl px-4 py-24 lg:px-12 lg:pt-40 lg:pb-36">
      <p ref={text} className="max-w-[1040px] font-display text-4xl font-semibold tracking-[-0.03em] text-balance lg:text-6xl lg:leading-16">
        {WORDS.map((word, i) => (
          <span key={i} className={`transition-colors duration-700 ease-drawer ${i < lit ? "text-ink" : "text-ink/25"}`}>
            {word}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}

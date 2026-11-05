import { Reveal } from "./Reveal.tsx";
import { SectionHead } from "./SectionHead.tsx";

const QUESTIONS = [
  ["How is this different from a yes or no market?", "A yes or no market pays a fixed amount. Here the payout grows the further the price ends past your line, up to a cap two price steps out."],
  ["When do markets end?", "Daily at 08:00 UTC, shown in your time zone."],
  ["Can I sell before the end?", "Yes, at the market maker's price, until 30 minutes before the end."],
  ["Do I have to collect?", "Turn on auto collect when you buy and the payout arrives on its own. Otherwise, tap Collect in the app."],
  ["What does it cost?", "The market maker's spread is in the price you see. There is no trading fee."],
  ["Is my position private?", "No. Option balances on NEAR Intents are public."],
] as const;

export function Faq() {
  return (
    <section id="faq" className="bg-surface py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 lg:px-12">
        <SectionHead title="Questions" />
        <dl className="grid gap-10 lg:grid-cols-2 lg:gap-x-16 lg:gap-y-12">
          {QUESTIONS.map(([question, answer], i) => (
            <Reveal key={question} delay={(i % 2) * 0.08}>
              <dt className="font-display text-xl font-semibold">{question}</dt>
              <dd className="mt-2 text-ink-2">{answer}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

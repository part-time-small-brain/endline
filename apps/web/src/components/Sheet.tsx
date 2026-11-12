import { type ReactNode, useEffect, useRef } from "react";

interface Props {
  title: string;
  detail?: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  children: ReactNode;
}

export function Sheet({ title, detail, onClose, dismissible = true, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = () => { if (dismissible) onClose(); };
  const close = useRef(dismiss);
  close.current = dismiss;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const scope = () => [...document.querySelectorAll<HTMLElement>(".hot-connector-popup")].filter((element) => element.getClientRects().length > 0).at(-1) ?? panel.current;
    const onKey = (event: KeyboardEvent) => {
      const root = scope();
      if (!root) return;
      if (event.key === "Escape" && root === panel.current) close.current();
      if (event.key !== "Tab") return;
      const targets = [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, iframe, [tabindex]")]
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = targets[0];
      const last = targets.at(-1);
      const active = document.activeElement as HTMLElement;
      if (!targets.includes(active) || active === (event.shiftKey ? first : last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        if (!first) {
          root.tabIndex = -1;
          root.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      const root = scope();
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        root.tabIndex = -1;
        root.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-scrim [animation:fade_.2s_ease-out]" onClick={dismiss} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] outline-none [animation:rise_.25s_var(--ease-drawer)] ring-1 ring-rule sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold">{title}</h2>
            {detail}
          </div>
          <button type="button" onClick={dismiss} disabled={!dismissible} aria-label="Close" className="grid size-9 place-items-center rounded-xl bg-well text-ink-2 hover:bg-well-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

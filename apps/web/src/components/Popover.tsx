import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  label: string;
  description?: string;
  button: ReactNode;
  buttonClassName: string;
  panelClassName: string;
  hover?: boolean;
  fit?: boolean;
  preferAbove?: boolean;
  children: ReactNode;
}

const EDGE = 12;

export function Popover({ label, description, button, buttonClassName, panelClassName, hover = false, fit = false, preferAbove = false, children }: Props) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const body = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open || !fit) return;
    const align = () => {
      const box = panel.current;
      const inner = body.current;
      const trigger = root.current?.querySelector("button");
      if (!box || !inner || !trigger) return;
      box.style.left = "0px";
      const page = document.documentElement;
      const anchor = trigger.getBoundingClientRect();
      if (anchor.bottom <= 0 || anchor.top >= page.clientHeight) {
        setOpen(false);
        return;
      }
      const below = page.clientHeight - anchor.bottom - EDGE;
      const over = anchor.top - EDGE;
      const height = inner.scrollHeight + 8;
      const flip = (preferAbove && height <= over) || (height > below && over > below);
      setAbove(flip);
      inner.style.maxHeight = `${Math.max(0, Math.floor((flip ? over : below) - 8))}px`;
      const { left, right } = inner.getBoundingClientRect();
      box.style.left = `${Math.min(Math.max(0, EDGE - left), page.getBoundingClientRect().width - EDGE - right)}px`;
    };
    align();
    window.addEventListener("resize", align);
    window.addEventListener("scroll", align);
    return () => {
      window.removeEventListener("resize", align);
      window.removeEventListener("scroll", align);
    };
  }, [open, fit, above, button, preferAbove]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <span
      ref={root}
      className="group/pop relative inline-flex"
      onBlur={(event) => event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }}
    >
      <button type="button" aria-label={label} aria-description={description} aria-expanded={open} onClick={() => setOpen(!open)} className={buttonClassName}>
        {button}
      </button>
      <span
        ref={panel}
        className={`absolute z-40 transition-none ${fit ? "left-0" : "right-0"} ${above ? "bottom-full pb-2" : "top-full pt-2"} ${open ? "block" : hover ? "hidden group-hover/pop:block" : "hidden"}`}
      >
        <span
          ref={body}
          className={`block whitespace-normal ${fit ? "overflow-y-auto overscroll-contain" : ""} [[data-theme=dark]_&]:ring-1 [[data-theme=dark]_&]:ring-rule near:ring-1 near:ring-rule ${panelClassName}`}
        >
          {children}
        </span>
      </span>
    </span>
  );
}

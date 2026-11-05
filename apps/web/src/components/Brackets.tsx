const CORNERS = [
  "-top-px -left-px rounded-tl-md border-t-2 border-l-2",
  "-top-px -right-px rounded-tr-md border-t-2 border-r-2",
  "-bottom-px -left-px rounded-bl-md border-b-2 border-l-2",
  "-right-px -bottom-px rounded-br-md border-r-2 border-b-2",
];

export function Brackets({ color }: { color: string }) {
  return CORNERS.map((corner) => <span key={corner} aria-hidden="true" className={`pointer-events-none absolute size-3 ${color} ${corner}`} />);
}

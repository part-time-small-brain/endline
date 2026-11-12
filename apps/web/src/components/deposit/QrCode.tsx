import { encode } from "uqr";

export function QrCode({ value }: { value: string }) {
  const { size, data } = encode(value, { border: 4 });
  const modules = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Deposit address QR code" shapeRendering="crispEdges" className="size-40 shrink-0 rounded-xl bg-white">
      <path d={modules} fill="#000" />
    </svg>
  );
}

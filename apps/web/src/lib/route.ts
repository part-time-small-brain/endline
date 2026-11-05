export type Route = "landing" | "trade" | "positions" | "missing";

export const PATHS = { landing: "/", trade: "/app", positions: "/app/positions" } as const;

export function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === PATHS.landing) return "landing";
  if (path === PATHS.trade) return "trade";
  if (path === PATHS.positions) return "positions";
  return "missing";
}

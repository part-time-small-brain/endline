export type Route = "landing" | "trade" | "positions" | "missing";

export type Paths = Record<"trade" | "positions", string>;

export const PATHS: Paths = { trade: "/app", positions: "/app/positions" };

export function pathsFor(appOrigin: string, origin: string): Paths {
  if (origin === appOrigin) return { trade: "/", positions: "/positions" };
  return { trade: `${appOrigin}/`, positions: `${appOrigin}/positions` };
}

export function routeOf(pathname: string, paths: Paths = PATHS): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  const at = (href: string) => path === (href.replace(/\/+$/, "") || "/");
  if (at(paths.trade)) return "trade";
  if (at(paths.positions)) return "positions";
  if (path === "/") return "landing";
  return "missing";
}

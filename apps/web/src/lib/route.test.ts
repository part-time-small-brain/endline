import { describe, expect, it } from "vitest";
import { pathsFor, routeOf } from "./route.ts";

describe("routeOf", () => {
  it("tolerates trailing slashes", () => {
    expect(routeOf("/")).toBe("landing");
    expect(routeOf("//")).toBe("landing");
    expect(routeOf("/app/")).toBe("trade");
    expect(routeOf("/app/positions///")).toBe("positions");
  });

  it("does not treat lookalike paths as app routes", () => {
    for (const path of ["/apps", "/app/position", "/app/positions/x", "/APP", "/app/trade", "/docs", "/positions"]) expect(routeOf(path)).toBe("missing");
  });

  it("puts the app at the root of the app origin and only the landing on any other", () => {
    const app = pathsFor("https://app.example.com", "https://app.example.com");
    expect(["/", "/positions/", "/app", "/app/positions", "/docs"].map((path) => routeOf(path, app))).toEqual(["trade", "positions", "missing", "missing", "missing"]);
    const landing = pathsFor("https://app.example.com", "https://example.com");
    expect(landing).toMatchObject({ trade: "https://app.example.com/", positions: "https://app.example.com/positions" });
    expect(["/", "/app", "/positions"].map((path) => routeOf(path, landing))).toEqual(["landing", "missing", "missing"]);
  });
});

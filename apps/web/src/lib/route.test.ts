import { describe, expect, it } from "vitest";
import { routeOf } from "./route.ts";

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
});

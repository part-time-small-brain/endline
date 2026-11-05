import { describe, expect, it } from "vitest";
import { NO_PULL, pull } from "./dots.ts";

const REACH = { x: 270, y: 150 };
const PART = 10;

describe("dot pull", () => {
  it("reaches further sideways than up and down, and nothing at or past the edge", () => {
    expect(pull(200, 0, REACH, PART).strength).toBeGreaterThan(0);
    expect(pull(0, 150, REACH, PART)).toBe(NO_PULL);
    expect(pull(270, 0, REACH, PART)).toBe(NO_PULL);
    expect(pull(269, 0, REACH, PART).strength).toBeGreaterThan(0);
    expect(pull(-220, -100, REACH, PART)).toBe(NO_PULL);
  });

  it("is full under the cursor and Up only above the line", () => {
    expect(pull(0, 0, REACH, PART).strength).toBe(1);
    expect(pull(40, -1, REACH, PART).up).toBe(true);
    expect(pull(40, 1, REACH, PART).up).toBe(false);
    expect(pull(40, 0, REACH, PART).up).toBe(false);
  });

  it("parts dots away from the line near it and leaves the line and far rows in place", () => {
    expect(pull(0, -9, REACH, PART).lift).toBeLessThan(0);
    expect(pull(0, 9, REACH, PART).lift).toBeGreaterThan(0);
    expect(Math.abs(pull(0, 0, REACH, PART).lift)).toBe(0);
    expect(Math.abs(pull(0, 75, REACH, PART).lift)).toBe(0);
    expect(Math.abs(pull(0, -100, REACH, PART).lift)).toBe(0);
  });

  it("still colors but never moves dots when motion is reduced", () => {
    for (const dy of [-60, -9, 9, 60]) {
      const still = pull(30, dy, REACH, 0);
      expect(Math.abs(still.lift)).toBe(0);
      expect(still.strength).toBeGreaterThan(0);
    }
  });

  it("stays bounded and fades with distance for random dots", () => {
    for (let n = 0; n < 2000; n++) {
      const angle = Math.random() * 2 * Math.PI;
      const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
      const near = Math.random() * 300;
      const far = near + Math.random() * 100;
      const a = pull(dx * near, dy * near, REACH, PART);
      const b = pull(dx * far, dy * far, REACH, PART);
      expect(a.strength).toBeGreaterThanOrEqual(0);
      expect(a.strength).toBeLessThanOrEqual(1);
      expect(b.strength).toBeLessThanOrEqual(a.strength);
      expect(Math.abs(a.lift)).toBeLessThanOrEqual(PART);
      expect(a.lift * dy).toBeGreaterThanOrEqual(0);
    }
  });
});

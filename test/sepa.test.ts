import { describe, expect, it } from "vitest";
import { sepaSafe } from "../src/sepa.js";

describe("sepaSafe", () => {
  it("replaces out-of-charset characters and collapses whitespace", () => {
    expect(sepaSafe("club maté   ½")).toBe("club mat");
  });

  it("keeps the allowed punctuation", () => {
    expect(sepaSafe("Order #12 (2x) +tip")).toBe("Order 12 (2x) +tip");
  });

  it("caps to the given length (35 for references)", () => {
    const long = "a".repeat(50);
    expect(sepaSafe(long, 35)).toHaveLength(35);
  });

  it("trims leading/trailing space introduced by stripping", () => {
    expect(sepaSafe("™hello™")).toBe("hello");
  });
});

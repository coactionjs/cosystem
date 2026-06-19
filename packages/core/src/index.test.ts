import { describe, expect, it } from "vitest";

import { createGreeting } from "./index.js";

describe("createGreeting", () => {
  it("greets a trimmed name", () => {
    expect(createGreeting(" CoSystem ")).toBe("Hello, CoSystem!");
  });

  it("falls back to world for blank input", () => {
    expect(createGreeting(" ")).toBe("Hello, world!");
  });
});

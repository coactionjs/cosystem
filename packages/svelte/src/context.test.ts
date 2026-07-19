import { describe, expect, it, vi } from "vitest";

import { createApp } from "@cosystem/core";

import { clearCoSystemApp, getCoSystemApp, setCoSystemApp, setCoSystemContext } from "./index.js";

const context = vi.hoisted(() => new Map<unknown, unknown>());

vi.mock("svelte", () => ({
  getContext: (key: unknown) => context.get(key),
  hasContext: (key: unknown) => context.has(key),
  setContext: (key: unknown, value: unknown) => {
    context.set(key, value);
    return value;
  },
}));

describe("Svelte app resolution precedence", () => {
  it("prefers component context over the global default app", () => {
    const globalApp = createApp();
    const contextApp = createApp();

    setCoSystemApp(globalApp);
    setCoSystemContext(contextApp);

    expect(getCoSystemApp()).toBe(contextApp);

    context.clear();

    expect(getCoSystemApp()).toBe(globalApp);

    clearCoSystemApp();

    expect(() => getCoSystemApp()).toThrow(/Missing CoSystem Svelte app/);
  });
});

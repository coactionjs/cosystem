import { afterEach, describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import { clearCoSystemApp, setCoSystemApp } from "./index.js";
import { moduleRune, selectedModuleRune, selectorRune } from "./runes.js";

class RuneCounter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }
}

defineModule(RuneCounter, {
  actions: ["increase"],
  computed: ["double"],
  name: "svelteRuneCounter",
  state: ["count"],
});

describe("Svelte rune helpers", () => {
  afterEach(() => {
    clearCoSystemApp();
  });

  it("exposes module instances through Svelte 5 friendly rune objects", () => {
    const app = createApp({
      providers: [RuneCounter],
    });
    setCoSystemApp(app);
    const counter = moduleRune(RuneCounter);

    counter.current.increase(2);

    expect(counter.current.count).toBe(2);
    expect(counter.value).toBe(counter.current);
    expect(counter.get()).toBe(counter.current);
  });

  it("reads selected values from the app with equality support", () => {
    const app = createApp({
      providers: [RuneCounter],
    });
    const counter = app.getModule(RuneCounter);
    const parity = selectorRune(
      (currentApp) => ({
        value: currentApp.getModule(RuneCounter).count % 2,
      }),
      {
        app,
        equals: (value, previous) => value.value === previous.value,
      },
    );
    const first = parity.current;

    counter.increase(2);

    expect(parity.current).toBe(first);

    counter.increase(1);

    expect(parity.current).toEqual({ value: 1 });
  });

  it("exposes selected module values through rune objects", () => {
    const app = createApp({
      providers: [RuneCounter],
    });
    const counter = app.getModule(RuneCounter);
    const double = selectedModuleRune(RuneCounter, (module) => module.double, { app });

    counter.increase(3);

    expect(double.current).toBe(6);
  });
});

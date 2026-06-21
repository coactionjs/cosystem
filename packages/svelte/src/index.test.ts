import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import {
  clearCoSystemApp,
  moduleStore,
  selectedModuleStore,
  selectorStore,
  setCoSystemApp,
} from "./index.js";

class Counter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  name: "svelteCounter",
  state: ["count"],
});

describe("Svelte adapter", () => {
  afterEach(() => {
    clearCoSystemApp();
  });

  it("exposes modules through Svelte readable stores", () => {
    const app = createApp({
      providers: [Counter],
    });
    setCoSystemApp(app);

    const counter = get(moduleStore(Counter));

    counter.increase(2);

    expect(counter.count).toBe(2);
  });

  it("updates selected readable stores from app state changes", () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    setCoSystemApp(app);

    const values: number[] = [];
    const store = selectedModuleStore(Counter, (module) => module.double);
    const unsubscribe = store.subscribe((value) => {
      values.push(value);
    });

    counter.increase(3);

    expect(get(store)).toBe(6);
    expect(values).toEqual([0, 6]);

    unsubscribe();
  });

  it("applies selector equality before publishing store values", () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    setCoSystemApp(app);

    const values: Array<{ readonly parity: number }> = [];
    const store = selectorStore(
      (currentApp) => ({
        parity: currentApp.getModule(Counter).count % 2,
      }),
      {
        equals: (value, previous) => value.parity === previous.parity,
      },
    );
    const unsubscribe = store.subscribe((value) => {
      values.push(value);
    });

    counter.increase(2);
    counter.increase(1);

    expect(values).toEqual([{ parity: 0 }, { parity: 1 }]);

    unsubscribe();
  });
});

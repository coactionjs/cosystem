import {
  createEnvironmentInjector,
  runInInjectionContext,
  type EnvironmentInjector,
} from "@angular/core";
import { describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import { injectCoSystemApp, injectModule, injectSignal, provideCoSystem } from "./index.js";

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
  name: "angularCounter",
  state: ["count"],
});

describe("Angular adapter", () => {
  it("bridges CoSystem apps through Angular providers", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      expect(injectCoSystemApp()).toBe(app);

      const counter = injectModule(Counter);

      counter.increase(2);

      expect(counter.count).toBe(2);
    });

    injector.destroy();
  });

  it("exposes selected module reads as Angular signals", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      const counter = injectModule(Counter);
      const double = injectSignal(Counter, (module) => module.double);

      expect(double()).toBe(0);

      counter.increase(3);

      expect(double()).toBe(6);
    });

    injector.destroy();
  });

  it("applies equality before updating Angular signals", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      const counter = injectModule(Counter);
      const parity = injectSignal(
        (currentApp) => ({
          value: currentApp.getModule(Counter).count % 2,
        }),
        {
          equals: (value, previous) => value.value === previous.value,
        },
      );
      const initial = parity();

      counter.increase(2);

      expect(parity()).toBe(initial);

      counter.increase(1);

      expect(parity()).toEqual({ value: 1 });
    });

    injector.destroy();
  });
});

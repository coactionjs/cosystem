import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import { CoSystemProvider, useModule, useSelector } from "./index.js";

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
  name: "reactCounter",
  state: ["count"],
});

describe("React adapter", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("provides modules and selector subscriptions through React APIs", () => {
    const app = createApp({
      providers: [Counter],
    });
    let counter: Counter | undefined;
    let selected = 0;
    let renderer: ReactTestRenderer | undefined;

    function View() {
      counter = useModule(Counter);
      selected = useSelector((currentApp) => currentApp.getModule(Counter).double);
      return createElement("span", null, selected);
    }

    act(() => {
      renderer = create(createElement(CoSystemProvider, { app }, createElement(View)));
    });

    expect(renderer?.toJSON()).toMatchObject({
      children: ["0"],
      type: "span",
    });

    act(() => {
      counter?.increase(3);
    });

    expect(selected).toBe(6);
    expect(renderer?.toJSON()).toMatchObject({
      children: ["6"],
      type: "span",
    });
  });

  it("uses selector equality to avoid unnecessary rerenders", () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    let renders = 0;

    function View() {
      renders += 1;
      const selected = useSelector(
        (currentApp) => ({
          parity: currentApp.getModule(Counter).count % 2,
        }),
        {
          equals: (value, previous) => value.parity === previous.parity,
        },
      );

      return createElement("span", null, selected.parity);
    }

    act(() => {
      create(createElement(CoSystemProvider, { app }, createElement(View)));
    });

    expect(renders).toBe(1);

    act(() => {
      counter.increase(2);
    });

    expect(renders).toBe(1);

    act(() => {
      counter.increase(1);
    });

    expect(renders).toBe(2);
  });
});

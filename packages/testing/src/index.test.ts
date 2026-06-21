import { describe, expect, it } from "vitest";

import { defineModule } from "@cosystem/core";

import { testApp } from "./index.js";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "testingCounter",
  state: ["count"],
});

describe("testing package", () => {
  it("re-exports the testApp runtime helper", () => {
    const app = testApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);

    counter.increase();

    expect(app.test.getActions()).toMatchObject([
      {
        method: "increase",
        module: "testingCounter",
      },
    ]);
  });
});

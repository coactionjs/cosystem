import { describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import { createDevtoolsPlugin } from "./index.js";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "devtoolsCounter",
  state: ["count"],
});

describe("devtools plugin", () => {
  it("records setup, action, and state timeline events", async () => {
    const devtools = createDevtoolsPlugin({
      now: () => 1,
    });
    const app = createApp({
      plugins: [devtools],
      providers: [Counter],
    });

    await app.start();
    app.getModule(Counter).increase();

    expect(devtools.getTimeline().map((event) => event.type)).toEqual([
      "setup",
      "action:start",
      "state",
      "action:end",
    ]);
  });

  it("trims old timeline events when maxEvents is reached", () => {
    const devtools = createDevtoolsPlugin({
      maxEvents: 2,
      now: () => 1,
    });
    const app = createApp({
      plugins: [devtools],
      providers: [Counter],
    });

    app.getModule(Counter).increase();

    expect(devtools.getTimeline()).toHaveLength(2);
    expect(devtools.getTimeline().map((event) => event.type)).toEqual(["state", "action:end"]);
  });
});

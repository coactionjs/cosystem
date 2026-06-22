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

class FailingAction {
  fail(): void {
    throw new Error("boom");
  }
}

defineModule(FailingAction, {
  actions: ["fail"],
  name: "devtoolsFailingAction",
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
      "module",
      "setup",
      "action:start",
      "state",
      "patch",
      "action:end",
    ]);
  });

  it("records module creation details", () => {
    const devtools = createDevtoolsPlugin({
      now: () => 1,
    });
    const app = createApp({
      plugins: [devtools],
      providers: [Counter],
    });
    const moduleEvent = devtools.getTimeline().find((event) => event.type === "module");

    expect(moduleEvent).toMatchObject({
      event: {
        instance: app.getModule(Counter),
        name: "devtoolsCounter",
        token: Counter,
      },
      type: "module",
    });
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
    expect(devtools.getTimeline().map((event) => event.type)).toEqual(["patch", "action:end"]);
  });

  it("returns timeline snapshots", () => {
    const devtools = createDevtoolsPlugin({
      now: () => 1,
    });
    const app = createApp({
      plugins: [devtools],
      providers: [Counter],
    });

    const snapshot = devtools.getTimeline();

    app.getModule(Counter).increase();
    devtools.clearTimeline();

    expect(snapshot.map((event) => event.type)).toEqual(["module", "setup"]);
    expect(devtools.getTimeline()).toEqual([]);
  });

  it("publishes timeline events to subscribers", () => {
    const devtools = createDevtoolsPlugin({
      maxEvents: 2,
      now: () => 1,
    });
    const events: string[] = [];
    const unsubscribe = devtools.subscribe((event) => {
      events.push(event.type);
    });
    const app = createApp({
      plugins: [devtools],
      providers: [Counter],
    });

    app.getModule(Counter).increase();
    unsubscribe();
    app.getModule(Counter).increase();

    expect(events).toEqual(["module", "setup", "action:start", "state", "patch", "action:end"]);
    expect(devtools.getTimeline().map((event) => event.type)).toEqual(["patch", "action:end"]);
  });

  it("records runtime errors", () => {
    const devtools = createDevtoolsPlugin({
      now: () => 1,
    });
    const app = createApp({
      plugins: [devtools],
      providers: [FailingAction],
    });

    expect(() => app.getModule(FailingAction).fail()).toThrow("boom");

    expect(devtools.getTimeline().map((event) => event.type)).toEqual([
      "module",
      "setup",
      "action:start",
      "error",
      "action:end",
    ]);
  });
});

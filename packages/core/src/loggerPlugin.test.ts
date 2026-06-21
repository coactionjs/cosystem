import { describe, expect, it } from "vitest";

import { createApp, createLoggerPlugin, defineModule, type LoggerPluginLogger } from "./index.js";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }

  fail(): void {
    throw new Error("boom");
  }
}

defineModule(Counter, {
  actions: ["increase", "fail"],
  name: "loggedCounter",
  state: ["count"],
});

class MemoryLogger implements LoggerPluginLogger {
  readonly entries: string[] = [];

  error(message: string): void {
    this.entries.push(`error:${message}`);
  }

  info(message: string): void {
    this.entries.push(`info:${message}`);
  }
}

describe("logger plugin", () => {
  it("logs module creation, completed actions, and runtime errors", () => {
    const logger = new MemoryLogger();
    const app = createApp({
      plugins: [createLoggerPlugin({ logger })],
      providers: [Counter],
    });
    const counter = app.getModule(Counter);

    counter.increase();
    expect(() => counter.fail()).toThrow("boom");

    expect(logger.entries).toEqual([
      "info:Module created: loggedCounter",
      "info:Action completed: loggedCounter.increase",
      "error:Runtime error during action",
      "error:Action failed: loggedCounter.fail",
    ]);
  });
});

import { createAppInternal, type MutableTestInspector } from "./app.js";
import type { ActionEvent, CreateAppOptions, TestAppInspector } from "./app.js";
import type { ProviderInput } from "./types.js";

export interface TestAppOptions extends Omit<CreateAppOptions, "providers"> {
  readonly providers?: readonly ProviderInput[];
  readonly overrides?: readonly ProviderInput[];
  readonly autoStart?: boolean;
  readonly strictActions?: boolean;
}

export interface TestApp extends ReturnType<typeof createAppInternal> {
  readonly test: TestAppInspector;
}

export function testApp(options: TestAppOptions = {}): TestApp {
  const inspector = createTestInspector();
  const { autoStart, overrides, strictActions, ...createOptions } = options;
  const app = createAppInternal({
    ...createOptions,
    devOptions: {
      ...createOptions.devOptions,
      ...(strictActions === undefined ? {} : { strictActions }),
    },
    ...(overrides === undefined ? {} : { overrides }),
    testInspector: inspector,
  }) as TestApp;

  Object.defineProperty(app, "test", {
    configurable: false,
    enumerable: false,
    value: inspector,
  });

  if (autoStart === true) {
    void app.start();
  }

  return app;
}

function createTestInspector(): MutableTestInspector {
  const actions: ActionEvent[] = [];
  const patches: unknown[] = [];
  let lastState: unknown;

  return {
    clearActions() {
      actions.length = 0;
    },
    clearPatches() {
      patches.length = 0;
    },
    flushEffects() {
      return Promise.resolve();
    },
    getActions() {
      return actions;
    },
    getPatches() {
      return patches;
    },
    getState() {
      return lastState;
    },
    recordAction(event) {
      actions.push(event);
    },
    recordPatch(patch) {
      lastState = patch;
      patches.push(patch);
    },
  };
}

import { describe, expect, it, vi } from "vitest";

vi.mock("./async-context.js", () => ({
  createRuntimeAsyncContext: () => undefined,
}));

import {
  InjectContextError,
  createApp,
  defineModule,
  inject,
  provide,
  token,
  type ModuleLifecycleContext,
  type PluginContext,
} from "./index.js";

describe("async context fallback", () => {
  it("rejects managed app lifecycle reentry after an await", async () => {
    class ManagedAppLifecycle {
      async onInit(context: ModuleLifecycleContext): Promise<void> {
        await Promise.resolve();
        await context.app.dispose();
      }
    }

    defineModule(ManagedAppLifecycle, {
      name: "managedAppLifecycle",
    });

    const app = createApp({ providers: [ManagedAppLifecycle] });

    await expect(app.ready).rejects.toThrow("Cannot call dispose() from app-managed onInit work.");
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("allows external disposal while fallback setup is suspended", async () => {
    const events: string[] = [];
    let markSetupStarted!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      markSetupStarted = resolve;
    });
    const app = createApp({
      plugins: [
        {
          setup(_app, context) {
            events.push("setup");

            return new Promise<void>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  events.push("abort");
                  resolve();
                },
                { once: true },
              );
              markSetupStarted();
            });
          },
        },
      ],
    });

    await setupStarted;
    await expect(app.dispose()).resolves.toBeUndefined();

    expect(events).toEqual(["setup", "abort"]);
  });

  it("keeps concurrent app lifecycle injection explicit and isolated", async () => {
    const Service = token<string>("FallbackService");
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const pluginValues: string[] = [];
    const reentryErrors: string[] = [];
    let firstPluginContext: PluginContext | undefined;

    class LifecycleReader {
      context: ModuleLifecycleContext | undefined;
      value = "pending";

      async onInit(context: ModuleLifecycleContext): Promise<void> {
        this.context = context;
        await Promise.resolve();
        this.value = context.inject(Service);
      }
    }

    defineModule(LifecycleReader, {
      name: "fallbackLifecycleReader",
      state: ["value"],
    });

    const first = createApp({
      plugins: [
        {
          async setup(runtimeApp, context) {
            firstPluginContext = context;
            markFirstStarted();
            await firstGate;
            expect(context.app).toBe(runtimeApp);
            expect(typeof runtimeApp.store.getPureState).toBe("function");
            await runtimeApp.dispose().catch((error: unknown) => {
              reentryErrors.push(error instanceof Error ? error.message : "unknown");
            });
            pluginValues.push(context.inject(Service));
          },
        },
      ],
      providers: [LifecycleReader, provide(Service, { useValue: "first" })],
    });
    const second = createApp({
      plugins: [
        {
          async setup(_app, context) {
            markSecondStarted();
            await secondGate;
            pluginValues.push(context.inject(Service));
          },
        },
      ],
      providers: [LifecycleReader, provide(Service, { useValue: "second" })],
    });

    await Promise.all([firstStarted, secondStarted]);
    expect(() => inject(Service)).toThrow(InjectContextError);

    releaseFirst();
    await first.ready;
    releaseSecond();
    await second.ready;

    expect(pluginValues).toEqual(["first", "second"]);
    expect(reentryErrors).toEqual(["Cannot call dispose() from app-managed setup work."]);
    expect(first.getModule(LifecycleReader).value).toBe("first");
    expect(second.getModule(LifecycleReader).value).toBe("second");
    expect(firstPluginContext).toBeDefined();
    expect(() => firstPluginContext!.inject(Service)).toThrow(InjectContextError);
    expect(first.getModule(LifecycleReader).context).toBeDefined();
    expect(() => first.getModule(LifecycleReader).context!.inject(Service)).toThrow(
      InjectContextError,
    );
    await Promise.all([first.dispose(), second.dispose()]);
  });
});

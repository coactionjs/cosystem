import {
  createEnvironmentInjector,
  runInInjectionContext,
  type EnvironmentInjector,
  type Signal,
} from "@angular/core";
import { renderToString } from "@vue/server-renderer";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { createRoot, getOwner, runWithOwner, type Accessor } from "solid-js";
import { get, type Unsubscriber } from "svelte/store";
import { createSSRApp, defineComponent, h, type Ref } from "vue";
import { describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";
import {
  CoSystemProvider as ReactCoSystemProvider,
  useModule as useReactModule,
  useSelector as useReactSelector,
} from "@cosystem/react";
import {
  CoSystemProvider as SolidCoSystemProvider,
  useComputed as useSolidComputed,
  useModule as useSolidModule,
} from "@cosystem/solid";
import {
  clearCoSystemApp,
  moduleStore as svelteModuleStore,
  selectedModuleStore as selectedSvelteModuleStore,
  setCoSystemApp,
} from "@cosystem/svelte";
import {
  injectModule as injectAngularModule,
  injectSignal as injectAngularSignal,
  provideCoSystem as provideAngularCoSystem,
} from "@cosystem/angular";
import {
  provideCoSystem as provideVueCoSystem,
  useComputed as useVueComputed,
  useModule as useVueModule,
} from "@cosystem/vue";

class SharedCounter {
  count = 0;

  increase(step = 1): void {
    this.count += step;
  }

  async increaseLater(step = 1): Promise<number> {
    await Promise.resolve();
    this.count += step;
    return this.count;
  }
}

defineModule(SharedCounter, {
  actions: ["increase", "increaseLater"],
  name: "frameworkAdapterCounter",
  state: ["count"],
});

describe("framework adapter integration", () => {
  it("shares one app and propagates state updates through all framework adapters", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const app = createApp({
      providers: [SharedCounter],
    });
    const counter = app.getModule(SharedCounter);
    let angularCounter: SharedCounter | undefined;
    let angularCount: Signal<number> | undefined;
    let angularInjector: EnvironmentInjector | undefined;
    let reactCounter: SharedCounter | undefined;
    let reactCount = 0;
    let reactRenderer: ReactTestRenderer | undefined;
    let solidCounter: SharedCounter | undefined;
    let solidCount: Accessor<number> | undefined;
    let solidDispose: (() => void) | undefined;
    let svelteCounter: SharedCounter | undefined;
    let svelteUnsubscribe: Unsubscriber | undefined;
    const svelteValues: number[] = [];
    let vueCounter: SharedCounter | undefined;
    let vueCount: Readonly<Ref<number>> | undefined;

    try {
      function ReactView() {
        reactCounter = useReactModule(SharedCounter);
        reactCount = useReactSelector(SharedCounter, (module) => module.count);
        return createElement("span", null, reactCount);
      }

      act(() => {
        reactRenderer = create(
          createElement(ReactCoSystemProvider, { app }, createElement(ReactView)),
        );
      });

      const VueConsumer = defineComponent({
        setup() {
          vueCounter = useVueModule(SharedCounter);
          vueCount = useVueComputed((currentApp) => currentApp.getModule(SharedCounter).count);
          return () => h("span", vueCount?.value);
        },
      });
      const VueRoot = defineComponent({
        setup() {
          provideVueCoSystem(app);
          return () => h(VueConsumer);
        },
      });

      await expect(renderToString(createSSRApp(VueRoot))).resolves.toBe("<span>0</span>");

      createRoot((dispose) => {
        solidDispose = dispose;
        SolidCoSystemProvider({
          app,
          get children() {
            const owner = getOwner();

            if (owner === null) {
              throw new Error("Missing Solid owner.");
            }

            runWithOwner(owner, () => {
              solidCounter = useSolidModule(SharedCounter);
              solidCount = useSolidComputed(SharedCounter, (module) => module.count);
            });

            return undefined;
          },
        });
      });

      setCoSystemApp(app);
      svelteCounter = get(svelteModuleStore(SharedCounter));
      const svelteCount = selectedSvelteModuleStore(SharedCounter, (module) => module.count);
      svelteUnsubscribe = svelteCount.subscribe((value) => {
        svelteValues.push(value);
      });

      angularInjector = createEnvironmentInjector(
        [provideAngularCoSystem(app)],
        null as unknown as EnvironmentInjector,
      );
      runInInjectionContext(angularInjector, () => {
        angularCounter = injectAngularModule(SharedCounter);
        angularCount = injectAngularSignal(SharedCounter, (module) => module.count);
      });

      expect(reactCounter).toBe(counter);
      expect(vueCounter).toBe(counter);
      expect(solidCounter).toBe(counter);
      expect(svelteCounter).toBe(counter);
      expect(angularCounter).toBe(counter);
      expect(readAdapterCounts()).toEqual([0, 0, 0, 0, 0]);
      expect(reactRenderer?.toJSON()).toMatchObject({
        children: ["0"],
        type: "span",
      });

      act(() => {
        angularCounter?.increase(2);
      });

      expect(readAdapterCounts()).toEqual([2, 2, 2, 2, 2]);
      expect(reactRenderer?.toJSON()).toMatchObject({
        children: ["2"],
        type: "span",
      });

      act(() => {
        svelteCounter?.increase(3);
      });

      expect(counter.count).toBe(5);
      expect(readAdapterCounts()).toEqual([5, 5, 5, 5, 5]);
      expect(svelteValues).toEqual([0, 2, 5]);

      await act(async () => {
        await expect(reactCounter?.increaseLater(4)).resolves.toBe(9);
      });

      expect(readAdapterCounts()).toEqual([9, 9, 9, 9, 9]);
      expect(reactRenderer?.toJSON()).toMatchObject({
        children: ["9"],
        type: "span",
      });

      await act(async () => {
        await expect(vueCounter?.increaseLater(5)).resolves.toBe(14);
      });

      expect(readAdapterCounts()).toEqual([14, 14, 14, 14, 14]);

      await act(async () => {
        await expect(solidCounter?.increaseLater(6)).resolves.toBe(20);
      });

      expect(readAdapterCounts()).toEqual([20, 20, 20, 20, 20]);

      await act(async () => {
        await expect(angularCounter?.increaseLater(7)).resolves.toBe(27);
      });

      expect(readAdapterCounts()).toEqual([27, 27, 27, 27, 27]);

      await act(async () => {
        await expect(svelteCounter?.increaseLater(8)).resolves.toBe(35);
      });

      expect(readAdapterCounts()).toEqual([35, 35, 35, 35, 35]);
      expect(svelteValues).toEqual([0, 2, 5, 9, 14, 20, 27, 35]);
    } finally {
      if (reactRenderer !== undefined) {
        act(() => {
          reactRenderer?.unmount();
        });
      }

      svelteUnsubscribe?.();
      clearCoSystemApp();
      solidDispose?.();
      angularInjector?.destroy();
    }

    function readAdapterCounts(): number[] {
      return [
        reactCount,
        vueCount?.value ?? Number.NaN,
        solidCount?.() ?? Number.NaN,
        get(selectedSvelteModuleStore(SharedCounter, (module) => module.count, { app })),
        angularCount?.() ?? Number.NaN,
      ];
    }
  });
});

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

import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
  type WorkerClient,
  type WorkerAppHost,
} from "@cosystem/core";
import {
  WorkerClientProvider as ReactWorkerClientProvider,
  useWorkerModule as useReactWorkerModule,
  useWorkerSelector as useReactWorkerSelector,
} from "@cosystem/react";
import {
  WorkerClientProvider as SolidWorkerClientProvider,
  useWorkerModule as useSolidWorkerModule,
  useWorkerSelector as useSolidWorkerSelector,
} from "@cosystem/solid";
import {
  clearWorkerClient,
  setWorkerClient,
  workerModuleStore as svelteWorkerModuleStore,
  workerSelectorStore as svelteWorkerSelectorStore,
} from "@cosystem/svelte";
import {
  injectWorkerModule as injectAngularWorkerModule,
  injectWorkerSignal as injectAngularWorkerSignal,
  provideWorkerClient as provideAngularWorkerClient,
} from "@cosystem/angular";
import {
  provideWorkerClient as provideVueWorkerClient,
  useWorkerModule as useVueWorkerModule,
  useWorkerSelector as useVueWorkerSelector,
} from "@cosystem/vue";

class SharedWorkerCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

defineModule(SharedWorkerCounter, {
  actions: ["increase"],
  name: "sharedWorkerCounter",
  state: ["count"],
});

describe("worker adapter integration", () => {
  it("shares one worker client and propagates worker state through all framework adapters", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const { client, host } = await startWorkerCounter();
    let angularCounter: AsyncMethodProxy<SharedWorkerCounter> | undefined;
    let angularCount: Signal<number> | undefined;
    let angularInjector: EnvironmentInjector | undefined;
    let reactCounter: AsyncMethodProxy<SharedWorkerCounter> | undefined;
    let reactCount = 0;
    let reactRenderer: ReactTestRenderer | undefined;
    let solidCounter: AsyncMethodProxy<SharedWorkerCounter> | undefined;
    let solidCount: Accessor<number> | undefined;
    let solidDispose: (() => void) | undefined;
    let svelteCounter: AsyncMethodProxy<SharedWorkerCounter> | undefined;
    let svelteUnsubscribe: Unsubscriber | undefined;
    const svelteValues: number[] = [];
    let vueCounter: AsyncMethodProxy<SharedWorkerCounter> | undefined;
    let vueCount: Readonly<Ref<number>> | undefined;

    try {
      function ReactView() {
        reactCounter = useReactWorkerModule<SharedWorkerCounter>("sharedWorkerCounter");
        reactCount = useReactWorkerSelector(selectSharedWorkerCount);
        return createElement("span", null, reactCount);
      }

      act(() => {
        reactRenderer = create(
          createElement(ReactWorkerClientProvider, { client }, createElement(ReactView)),
        );
      });

      const VueConsumer = defineComponent({
        setup() {
          vueCounter = useVueWorkerModule<SharedWorkerCounter>("sharedWorkerCounter");
          vueCount = useVueWorkerSelector(selectSharedWorkerCount);
          return () => h("span", vueCount?.value);
        },
      });
      const VueRoot = defineComponent({
        setup() {
          provideVueWorkerClient(client);
          return () => h(VueConsumer);
        },
      });

      await expect(renderToString(createSSRApp(VueRoot))).resolves.toBe("<span>0</span>");

      createRoot((dispose) => {
        solidDispose = dispose;
        SolidWorkerClientProvider({
          client,
          get children() {
            const owner = getOwner();

            if (owner === null) {
              throw new Error("Missing Solid owner.");
            }

            runWithOwner(owner, () => {
              solidCounter = useSolidWorkerModule<SharedWorkerCounter>("sharedWorkerCounter");
              solidCount = useSolidWorkerSelector(selectSharedWorkerCount);
            });

            return undefined;
          },
        });
      });

      setWorkerClient(client);
      svelteCounter = get(svelteWorkerModuleStore<SharedWorkerCounter>("sharedWorkerCounter"));
      const svelteCount = svelteWorkerSelectorStore(selectSharedWorkerCount);
      svelteUnsubscribe = svelteCount.subscribe((value) => {
        svelteValues.push(value);
      });

      angularInjector = createEnvironmentInjector(
        [provideAngularWorkerClient(client)],
        null as unknown as EnvironmentInjector,
      );
      runInInjectionContext(angularInjector, () => {
        angularCounter = injectAngularWorkerModule<SharedWorkerCounter>("sharedWorkerCounter");
        angularCount = injectAngularWorkerSignal(selectSharedWorkerCount);
      });

      expect(readAdapterCounts()).toEqual([0, 0, 0, 0, 0]);
      expect(reactRenderer?.toJSON()).toMatchObject({
        children: ["0"],
        type: "span",
      });

      await act(async () => {
        await angularCounter?.increase(2);
      });

      expect(readAdapterCounts()).toEqual([2, 2, 2, 2, 2]);
      expect(reactRenderer?.toJSON()).toMatchObject({
        children: ["2"],
        type: "span",
      });

      await act(async () => {
        await svelteCounter?.increase(3);
      });

      expect(readAdapterCounts()).toEqual([5, 5, 5, 5, 5]);
      expect(svelteValues).toEqual([0, 2, 5]);

      await act(async () => {
        await reactCounter?.increase(1);
      });

      expect(readAdapterCounts()).toEqual([6, 6, 6, 6, 6]);
      await act(async () => {
        await expect(vueCounter?.increase(4)).resolves.toBe(10);
      });

      expect(readAdapterCounts()).toEqual([10, 10, 10, 10, 10]);
      await act(async () => {
        await expect(solidCounter?.increase(5)).resolves.toBe(15);
      });

      expect(readAdapterCounts()).toEqual([15, 15, 15, 15, 15]);
    } finally {
      if (reactRenderer !== undefined) {
        act(() => {
          reactRenderer?.unmount();
        });
      }

      svelteUnsubscribe?.();
      clearWorkerClient();
      solidDispose?.();
      angularInjector?.destroy();
      client.dispose();
      await host.dispose();
    }

    function readAdapterCounts(): number[] {
      return [
        reactCount,
        vueCount?.value ?? Number.NaN,
        solidCount?.() ?? Number.NaN,
        get(svelteWorkerSelectorStore(selectSharedWorkerCount, { client })),
        angularCount?.() ?? Number.NaN,
      ];
    }
  });
});

async function startWorkerCounter(): Promise<{
  readonly client: WorkerClient;
  readonly host: WorkerAppHost;
}> {
  const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
  const client = createWorkerClient({
    transport: clientTransport,
  });
  const host = createWorkerApp({
    providers: [SharedWorkerCounter],
    sync: "patch",
    transport: hostTransport,
  });

  await client.ready;

  return {
    client,
    host,
  };
}

function selectSharedWorkerCount(state: unknown): number {
  return (state as SharedWorkerCounterState).sharedWorkerCounter.count;
}

interface SharedWorkerCounterState {
  readonly sharedWorkerCounter: {
    readonly count: number;
  };
}

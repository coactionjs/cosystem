import { renderToString } from "@vue/server-renderer";
import { createSSRApp, defineComponent, h, type Ref } from "vue";
import { describe, expect, it } from "vitest";

import {
  createApp,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
} from "@cosystem/core";

import {
  cosystemPlugin,
  provideCoSystem,
  provideWorkerClient,
  useApp,
  useComputed,
  useModule,
  useSelector,
  useWorkerModule,
  useWorkerSelector,
} from "./index.js";

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
  name: "vueCounter",
  state: ["count"],
});

describe("Vue adapter", () => {
  it("provides modules and selector refs through Vue APIs", async () => {
    const app = createApp({
      providers: [Counter],
    });
    let counter: Counter | undefined;
    let selected: Readonly<Ref<number>> | undefined;

    const Consumer = defineComponent({
      setup() {
        expect(useApp()).toBe(app);
        counter = useModule(Counter);
        selected = useComputed((currentApp) => currentApp.getModule(Counter).double);
        return () => h("span", selected?.value);
      },
    });

    const Root = defineComponent({
      setup() {
        provideCoSystem(app);
        return () => h(Consumer);
      },
    });

    const html = await renderToString(createSSRApp(Root));

    expect(html).toBe("<span>0</span>");

    counter?.increase(4);

    expect(selected?.value).toBe(8);
  });

  it("uses selector equality before updating refs", async () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    let selected: Readonly<Ref<{ readonly parity: number }>> | undefined;

    const Consumer = defineComponent({
      setup() {
        selected = useSelector(
          (currentApp) => ({
            parity: currentApp.getModule(Counter).count % 2,
          }),
          {
            equals: (value, previous) => value.parity === previous.parity,
          },
        );
        return () => h("span", selected?.value.parity);
      },
    });

    const Root = defineComponent({
      setup() {
        provideCoSystem(app);
        return () => h(Consumer);
      },
    });

    await renderToString(createSSRApp(Root));

    const initial = selected?.value;

    counter.increase(2);

    expect(selected?.value).toBe(initial);

    counter.increase(1);

    expect(selected?.value).toEqual({ parity: 1 });
  });

  it("can install the app through the Vue plugin API", async () => {
    const app = createApp({
      providers: [Counter],
    });

    const Consumer = defineComponent({
      setup() {
        return () => h("span", useModule(Counter).count);
      },
    });

    const vueApp = createSSRApp(Consumer);
    vueApp.use(cosystemPlugin(app));

    await expect(renderToString(vueApp)).resolves.toBe("<span>0</span>");
  });

  it("provides worker modules and selector refs through Vue APIs", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [Counter],
      sync: "patch",
      transport: hostTransport,
    });
    let counter: AsyncMethodProxy<Counter> | undefined;
    let selected: Readonly<Ref<number>> | undefined;

    await client.ready;

    const Consumer = defineComponent({
      setup() {
        counter = useWorkerModule<Counter>("vueCounter");
        selected = useWorkerSelector((state) => (state as WorkerCounterState).vueCounter.count);
        return () => h("span", selected?.value);
      },
    });

    const Root = defineComponent({
      setup() {
        provideWorkerClient(client);
        return () => h(Consumer);
      },
    });

    const html = await renderToString(createSSRApp(Root));

    expect(html).toBe("<span>0</span>");

    await counter?.increase(5);

    expect(selected?.value).toBe(5);

    client.dispose();
    await host.dispose();
  });
});

interface WorkerCounterState {
  readonly vueCounter: {
    readonly count: number;
  };
}

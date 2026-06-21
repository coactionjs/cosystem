# Vue Counter

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { createApp, defineModule } from "@cosystem/core";
import { cosystemPlugin, useComputed, useModule } from "@cosystem/vue";

class Counter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  name: "counter",
  state: ["count"],
});

const app = createApp({
  providers: [Counter],
});

const CounterView = defineComponent({
  setup() {
    const counter = useModule(Counter);
    const count = useComputed(() => counter.count);
    const double = useComputed(() => counter.double);

    return () =>
      h("button", { onClick: () => counter.increase() }, `${count.value} / ${double.value}`);
  },
});

createVueApp(CounterView).use(cosystemPlugin(app)).mount("#app");
```

The Vue adapter can also render worker-hosted state through a `WorkerClient`:

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import type { WorkerClient } from "@cosystem/core";
import { workerClientPlugin, useWorkerModule, useWorkerSelector } from "@cosystem/vue";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

const WorkerCounterView = defineComponent({
  setup() {
    const counter = useWorkerModule<Counter>("counter");
    const count = useWorkerSelector((state) => (state as CounterState).counter.count);

    return () => h("button", { onClick: () => counter.increase() }, count.value);
  },
});

function renderWorkerCounter(client: WorkerClient) {
  createVueApp(WorkerCounterView).use(workerClientPlugin(client)).mount("#app");
}
```

# Solid Counter

```tsx
import { render } from "solid-js/web";
import { createApp, defineModule } from "@cosystem/core";
import { CoSystemProvider, useComputed, useModule } from "@cosystem/solid";

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

function CounterView() {
  const counter = useModule(Counter);
  const count = useComputed(Counter, (module) => module.count);
  const double = useComputed(Counter, (module) => module.double);

  return (
    <button onClick={() => counter.increase()}>
      {count()} / {double()}
    </button>
  );
}

render(
  () => (
    <CoSystemProvider app={app}>
      <CounterView />
    </CoSystemProvider>
  ),
  document.getElementById("root")!,
);
```

The Solid adapter can also render worker-hosted state through a `WorkerClient`:

```tsx
import { render } from "solid-js/web";
import type { WorkerClient } from "@cosystem/core";
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/solid";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

function WorkerCounterView() {
  const counter = useWorkerModule<Counter>("counter");
  const count = useWorkerSelector((state) => (state as CounterState).counter.count);

  return <button onClick={() => counter.increase()}>{count()}</button>;
}

function renderWorkerCounter(client: WorkerClient) {
  render(
    () => (
      <WorkerClientProvider client={client}>
        <WorkerCounterView />
      </WorkerClientProvider>
    ),
    document.getElementById("root")!,
  );
}
```

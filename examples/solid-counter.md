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

# React Counter

```tsx
import { createRoot } from "react-dom/client";
import { createApp, defineModule } from "@cosystem/core";
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";

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
  const count = useSelector(Counter, (module) => module.count);
  const double = useSelector(Counter, (module) => module.double);

  return (
    <button onClick={() => counter.increase()}>
      {count} / {double}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <CoSystemProvider app={app}>
    <CounterView />
  </CoSystemProvider>,
);
```

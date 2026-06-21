import { createRoot } from "react-dom/client";

import { createApp, defineModule } from "@cosystem/core";
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";

import "./styles.css";

class Counter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }

  reset(): void {
    this.count = 0;
  }
}

defineModule(Counter, {
  actions: ["increase", "reset"],
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
    <main className="shell">
      <section className="panel">
        <span className="eyebrow">React + CoSystem</span>
        <h1>Counter module</h1>
        <dl className="stats">
          <div>
            <dt>Count</dt>
            <dd>{count}</dd>
          </div>
          <div>
            <dt>Double</dt>
            <dd>{double}</dd>
          </div>
        </dl>
        <div className="actions">
          <button type="button" onClick={() => counter.increase()}>
            Increase
          </button>
          <button type="button" className="secondary" onClick={() => counter.reset()}>
            Reset
          </button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <CoSystemProvider app={app}>
    <CounterView />
  </CoSystemProvider>,
);

import { render } from "solid-js/web";

import { createApp, defineModule } from "@cosystem/core";
import { CoSystemProvider, useComputed, useModule } from "@cosystem/solid";

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
  const count = useComputed(Counter, (module) => module.count);
  const double = useComputed(Counter, (module) => module.double);

  return (
    <main class="shell">
      <section class="panel">
        <span class="eyebrow">Solid + CoSystem</span>
        <h1>Counter module</h1>
        <dl class="stats">
          <div>
            <dt>Count</dt>
            <dd>{count()}</dd>
          </div>
          <div>
            <dt>Double</dt>
            <dd>{double()}</dd>
          </div>
        </dl>
        <div class="actions">
          <button type="button" onClick={() => counter.increase()}>
            Increase
          </button>
          <button type="button" class="secondary" onClick={() => counter.reset()}>
            Reset
          </button>
        </div>
      </section>
    </main>
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

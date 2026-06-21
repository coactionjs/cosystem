import { createApp, defineModule, provide } from "@cosystem/core";

// oxlint-disable-next-line import/no-unassigned-import -- Vite loads example styles through CSS side effects.
import "./styles.css";

abstract class Logger {
  abstract info(message: string): void;
}

class MemoryLogger implements Logger {
  readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }
}

class Counter {
  count = 0;

  constructor(readonly logger: Logger) {}

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }

  reset(): void {
    this.count = 0;
    this.logger.info("reset");
  }
}

defineModule(Counter, {
  actions: ["increase", "reset"],
  computed: ["double"],
  deps: [Logger],
  name: "counter",
  state: ["count"],
});

const logger = new MemoryLogger();
const app = createApp({
  providers: [Counter, provide(Logger, { useValue: logger })],
});
const counter = app.getModule(Counter);
const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing #app.");
}

app.watch(
  () => ({
    count: counter.count,
    double: counter.double,
    messages: [...logger.messages],
  }),
  render,
  { immediate: true },
);

function render(snapshot: CounterSnapshot): void {
  root!.innerHTML = `
    <section class="panel">
      <span class="eyebrow">No decorators</span>
      <h1>Counter module</h1>
      <dl class="stats">
        <div><dt>Count</dt><dd>${snapshot.count}</dd></div>
        <div><dt>Double</dt><dd>${snapshot.double}</dd></div>
      </dl>
      <div class="actions">
        <button type="button" data-action="increase">Increase</button>
        <button type="button" class="secondary" data-action="reset">Reset</button>
      </div>
      <pre>${snapshot.messages.join("\n") || "No logs yet"}</pre>
    </section>
  `;
}

root.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.dataset.action === "increase") {
    counter.increase();
  }

  if (target.dataset.action === "reset") {
    counter.reset();
  }
});

interface CounterSnapshot {
  readonly count: number;
  readonly double: number;
  readonly messages: readonly string[];
}

import {
  createPostMessageWorkerTransport,
  createWorkerClient,
  type AsyncMethodProxy,
} from "@cosystem/core";

import "./styles.css";

interface CounterApi {
  increase(step?: number): number;
  reset(): number;
}

interface CounterState {
  readonly counter: {
    readonly count: number;
    readonly double?: number;
  };
}

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing #app.");
}

const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
const counter: AsyncMethodProxy<CounterApi> = client.module<CounterApi>("counter");
const selectCount = (state: unknown) => (state as CounterState).counter.count;
let count = 0;
let ready = false;

render();
await client.ready;

ready = true;
count = client.select(selectCount);
const unsubscribe = client.watch(selectCount, (value) => {
  count = value;
  render();
});

render();

root.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.dataset.action === "increase") {
    void counter.increase();
  }

  if (target.dataset.action === "reset") {
    void counter.reset();
  }
});

window.addEventListener("beforeunload", () => {
  unsubscribe();
  client.dispose();
  worker.terminate();
});

function render(): void {
  root!.innerHTML = `
    <section class="panel">
      <span class="eyebrow">Web Worker runtime</span>
      <h1>Worker counter</h1>
      <p>${ready ? "The app module is running in a Vite Web Worker." : "Connecting to worker..."}</p>
      <dl class="stats">
        <div><dt>Count</dt><dd>${count}</dd></div>
        <div><dt>Double</dt><dd>${count * 2}</dd></div>
      </dl>
      <div class="actions">
        <button type="button" data-action="increase" ${ready ? "" : "disabled"}>Increase in worker</button>
        <button type="button" class="secondary" data-action="reset" ${ready ? "" : "disabled"}>Reset</button>
      </div>
    </section>
  `;
}

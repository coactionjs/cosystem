import {
  Action,
  Computed,
  Module,
  State,
  createApp,
  getModuleMetadata,
  provide,
} from "@cosystem/core";

// oxlint-disable-next-line import/no-unassigned-import -- Vite loads example styles through CSS side effects.
import "./styles.css";

class Logger {
  info() {
    throw new Error("Logger.info() must be implemented.");
  }
}

class MemoryLogger extends Logger {
  messages = [];

  info(message) {
    this.messages.push(message);
  }
}

@Module({
  deps: [Logger],
  name: "counter",
})
class Counter {
  constructor(logger) {
    this.logger = logger;
  }

  @State
  accessor count = 0;

  @Computed
  get double() {
    return this.count * 2;
  }

  @Action
  increase(step = 1) {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }

  @Action
  reset() {
    this.count = 0;
    this.logger.info("reset");
  }
}

const logger = new MemoryLogger();
const app = createApp({
  providers: [Counter, provide(Logger, { useValue: logger })],
});
const counter = app.getModule(Counter);
const metadata = getModuleMetadata(Counter);
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

function render(snapshot) {
  root.innerHTML = `
    <section class="panel">
      <span class="eyebrow">JavaScript decorators</span>
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
      <pre>${metadataLines().join("\n")}</pre>
    </section>
  `;
}

function metadataLines() {
  return [
    `module:${metadata?.name ?? "unknown"}`,
    `state:${[...(metadata?.state ?? [])].join(",")}`,
    `computed:${[...(metadata?.computed ?? [])].join(",")}`,
    `actions:${[...(metadata?.actions ?? [])].join(",")}`,
    `deps:${metadata?.deps?.length ?? 0}`,
  ];
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

import {
  createPostMessageWorkerTransport,
  createWorkerApp,
  defineModule,
  type PostMessageEndpoint,
} from "@cosystem/core";

class Counter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }

  reset(): number {
    this.count = 0;
    return this.count;
  }
}

defineModule(Counter, {
  actions: ["increase", "reset"],
  computed: ["double"],
  name: "counter",
  state: ["count"],
});

const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createPostMessageWorkerTransport(globalThis as unknown as PostMessageEndpoint),
});

void host.ready;

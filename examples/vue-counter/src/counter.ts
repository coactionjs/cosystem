import { createApp, defineModule } from "@cosystem/core";

export class Counter {
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

export const cosystem = createApp({
  providers: [Counter],
});

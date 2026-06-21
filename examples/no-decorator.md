# No-Decorator Module

```ts
import { createApp, defineModule, provide } from "@cosystem/core";

abstract class Logger {
  abstract info(message: string): void;
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
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [Logger],
  name: "counter",
  state: ["count"],
});

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
});

app.getModule(Counter).increase();
```

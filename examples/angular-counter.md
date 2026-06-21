# Angular Counter

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { createApp, defineModule } from "@cosystem/core";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

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

@Component({
  selector: "counter-view",
  template: ` <button (click)="counter.increase()">{{ count() }} / {{ double() }}</button> `,
})
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (module) => module.count);
  readonly double = injectSignal(Counter, (module) => module.double);
}

bootstrapApplication(CounterView, {
  providers: [provideCoSystem(app)],
});
```

The Angular adapter can also consume worker-hosted state through Angular DI and
signals:

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import type { WorkerClient } from "@cosystem/core";
import { injectWorkerModule, injectWorkerSignal, provideWorkerClient } from "@cosystem/angular";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

@Component({
  selector: "counter-view",
  template: ` <button (click)="counter.increase()">{{ count() }}</button> `,
})
class WorkerCounterView {
  readonly counter = injectWorkerModule<Counter>("counter");
  readonly count = injectWorkerSignal((state) => (state as CounterState).counter.count);
}

function renderWorkerCounter(client: WorkerClient) {
  void bootstrapApplication(WorkerCounterView, {
    providers: [provideWorkerClient(client)],
  });
}
```

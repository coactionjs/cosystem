# Vue Counter

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { createApp, defineModule } from "@cosystem/core";
import { provideCoSystem, useModule, useSelector } from "@cosystem/vue";

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

const CounterView = defineComponent({
  setup() {
    const counter = useModule(Counter);
    const count = useSelector(() => counter.count);
    const double = useSelector(() => counter.double);

    return () =>
      h("button", { onClick: () => counter.increase() }, `${count.value} / ${double.value}`);
  },
});

createVueApp({
  setup() {
    provideCoSystem(app);
    return () => h(CounterView);
  },
}).mount("#app");
```

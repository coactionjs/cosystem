# Lazy Module

```ts
import { createApp, defineModule, lazyModule } from "@cosystem/core";

class AdminCounter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(AdminCounter, {
  actions: ["increase"],
  name: "adminCounter",
  state: ["count"],
});

const app = createApp({
  providers: [
    lazyModule(async () => ({
      providers: [AdminCounter],
    })),
  ],
});

await app.load();

const admin = app.getModule(AdminCounter);
admin.increase();

console.log(app.store.getPureState());
```

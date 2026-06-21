# Svelte Counter

```svelte
<script lang="ts">
  import { createApp, defineModule } from "@cosystem/core";
  import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";

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

  setCoSystemApp(app);

  const counter = moduleStore(Counter);
  const count = selectedModuleStore(Counter, (module) => module.count);
  const double = selectedModuleStore(Counter, (module) => module.double);
</script>

<button on:click={() => $counter.increase()}>
  {$count} / {$double}
</button>
```

Svelte 5 projects can use the rune-friendly subpath:

```svelte
<script lang="ts">
  import { createApp, defineModule } from "@cosystem/core";
  import { moduleRune, selectedModuleRune } from "@cosystem/svelte/runes";

  class Counter {
    count = 0;

    increase(): void {
      this.count += 1;
    }
  }

  defineModule(Counter, {
    actions: ["increase"],
    name: "counter",
    state: ["count"],
  });

  const app = createApp({
    providers: [Counter],
  });

  const counter = moduleRune(Counter, { app });
  const count = selectedModuleRune(Counter, (module) => module.count, { app });
</script>

<button onclick={() => counter.current.increase()}>
  {count.current}
</button>
```

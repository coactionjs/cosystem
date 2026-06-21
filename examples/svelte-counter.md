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

The Svelte adapter can also render worker-hosted state through readable stores:

```svelte
<script lang="ts">
  import type { WorkerClient } from "@cosystem/core";
  import { setWorkerClient, workerModuleStore, workerSelectorStore } from "@cosystem/svelte";

  type CounterState = {
    readonly counter: {
      readonly count: number;
    };
  };

  export let client: WorkerClient;

  setWorkerClient(client);

  const counter = workerModuleStore<Counter>("counter");
  const count = workerSelectorStore((state) => (state as CounterState).counter.count);
</script>

<button on:click={() => $counter.increase()}>
  {$count}
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

Worker-hosted state has matching Svelte 5 rune helpers:

```svelte
<script lang="ts">
  import type { WorkerClient } from "@cosystem/core";
  import { workerModuleRune, workerSelectorRune } from "@cosystem/svelte/runes";

  type CounterState = {
    readonly counter: {
      readonly count: number;
    };
  };

  export let client: WorkerClient;

  const counter = workerModuleRune<Counter>("counter", { client });
  const count = workerSelectorRune((state) => (state as CounterState).counter.count, {
    client,
  });
</script>

<button onclick={() => counter.current.increase()}>
  {count.current}
</button>
```

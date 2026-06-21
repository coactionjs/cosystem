# CoSystem Examples

Each example is a runnable workspace package. Install dependencies once from the
repository root:

```sh
pnpm install
```

Run one example with its workspace filter:

```sh
pnpm --filter @cosystem/example-react-counter dev
pnpm --filter @cosystem/example-vue-counter dev
pnpm --filter @cosystem/example-svelte-counter dev
pnpm --filter @cosystem/example-solid-counter dev
pnpm --filter @cosystem/example-angular-counter dev
```

Core examples use the same Vite workflow:

```sh
pnpm --filter @cosystem/example-no-decorator dev
pnpm --filter @cosystem/example-lazy-module dev
pnpm --filter @cosystem/example-router dev
pnpm --filter @cosystem/example-worker-counter dev
```

The testing example is runnable through Vitest:

```sh
pnpm --filter @cosystem/example-testing test
```

# CoSystem Examples

Each example is a runnable workspace package that demonstrates one slice of
CoSystem. They share the same `Counter` module across frameworks so you can
compare adapters directly.

## Overview

| Example                                | Package                             | Demonstrates                                                             |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| [`react-counter`](./react-counter)     | `@cosystem/example-react-counter`   | React adapter: `CoSystemProvider`, `useModule`, `useSelector`.           |
| [`vue-counter`](./vue-counter)         | `@cosystem/example-vue-counter`     | Vue adapter: `cosystemPlugin`, `useModule`, `useComputed`.               |
| [`svelte-counter`](./svelte-counter)   | `@cosystem/example-svelte-counter`  | Svelte adapter: readable stores and `$store` syntax.                     |
| [`solid-counter`](./solid-counter)     | `@cosystem/example-solid-counter`   | Solid adapter: `CoSystemProvider`, `useComputed` accessors.              |
| [`angular-counter`](./angular-counter) | `@cosystem/example-angular-counter` | Angular adapter: `provideCoSystem`, `injectModule`, `injectSignal`.      |
| [`ts-decorator`](./ts-decorator)       | `@cosystem/example-ts-decorator`    | TypeScript standard decorators: `@Module`, `@State accessor`, metadata.  |
| [`js-decorator`](./js-decorator)       | `@cosystem/example-js-decorator`    | JavaScript standard decorators with explicit dependency metadata.        |
| [`no-decorator`](./no-decorator)       | `@cosystem/example-no-decorator`    | Defining modules with `defineModule()` metadata instead of decorators.   |
| [`lazy-module`](./lazy-module)         | `@cosystem/example-lazy-module`     | Explicit lazy modules with `lazyModule()` and `app.load()`.              |
| [`router`](./router)                   | `@cosystem/example-router`          | Router primitives, `RouterToken`, and `createRouterPlugin`.              |
| [`worker-counter`](./worker-counter)   | `@cosystem/example-worker-counter`  | Hosting a module in a Web Worker and consuming it with a `WorkerClient`. |
| [`testing`](./testing)                 | `@cosystem/example-testing`         | `testApp()` with provider overrides and action/state assertions.         |

## Running an example

Install dependencies once from the repository root:

```sh
pnpm install
```

The Vite-based examples run with their workspace filter:

```sh
pnpm --filter @cosystem/example-react-counter dev
pnpm --filter @cosystem/example-vue-counter dev
pnpm --filter @cosystem/example-svelte-counter dev
pnpm --filter @cosystem/example-solid-counter dev
pnpm --filter @cosystem/example-angular-counter dev
```

Core-focused examples use the same Vite workflow:

```sh
pnpm --filter @cosystem/example-no-decorator dev
pnpm --filter @cosystem/example-ts-decorator dev
pnpm --filter @cosystem/example-js-decorator dev
pnpm --filter @cosystem/example-lazy-module dev
pnpm --filter @cosystem/example-router dev
pnpm --filter @cosystem/example-worker-counter dev
```

The testing example is runnable through Vitest:

```sh
pnpm --filter @cosystem/example-testing test
```

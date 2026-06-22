# Architecture

This document explains how CoSystem is layered, where the boundaries are, and the
principles behind the design decisions.

## Layered design

```txt
Application code
  │ uses
  ▼
@cosystem/core ──── createApp(), DI container, modules, single store, lifecycle, plugins,
  │ uses             decorators, metadata, test utilities, worker host/client
  ▼
coaction ────────── signals, computed caching, mutative updates, patches,
  │ consumed by      data-transport integration, worker/share synchronization
  ▼
@cosystem/react · @cosystem/vue · @cosystem/svelte · @cosystem/solid · @cosystem/angular
```

The boundary between the two libraries is intentional:

```txt
Coaction
  Reactive state, signals, transport, worker/share synchronization.

CoSystem
  Application runtime, DI, OO modules, lifecycle, testing, UI adapters.
```

CoSystem is "powered by Coaction" — Coaction is a powerful implementation
dependency, not part of the user's required mental model. CoSystem owns the
app-framework API, docs, examples, release cadence, and brand.

## Package boundaries

| Layer    | Packages                                     | Rule                                                                                                                       |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Core     | `@cosystem/core`                             | Depends only on `coaction`. Must **not** import any UI framework. Owns the public app-runtime API.                         |
| Adapters | `react`, `vue`, `svelte`, `solid`, `angular` | Depend on `@cosystem/core` + their target framework (peer dependency). Expose CoSystem-branded, framework-native bindings. |
| Plugins  | `router`, `storage`, `devtools`              | Depend on `@cosystem/core`. Implement the `Plugin` contract. Never required by the core.                                   |
| Tooling  | `create`, `testing`, `tsconfig`              | Scaffolding, test facade, and shared TS config.                                                                            |

Two hard constraints:

1. **The core never imports React/Vue/Svelte/Solid/Angular.** That is what lets
   the same module run under any framework, in a worker, or headless in tests.
2. **The core never mounts UI.** There is no `render()`, `bootstrap()`,
   `ViewModule`, or root component base class. Mounting stays native to each
   framework.

## Design principles

### Explicit, reflection-free DI

The DI container does not use `reflect-metadata` or `emitDecoratorMetadata`, does
not parse constructor parameter names, has no parameter decorators, and uses no
Proxy-based resolution. You declare tokens and dependency lists explicitly. This
is portable across TypeScript, Babel, SWC, esbuild, and worker runtimes — and
gives the runtime tight control over scopes, lifecycle, worker boundaries, test
overrides, and disposal. See [Dependency Injection](./dependency-injection.md).

### Decorators are optional

`@module`/`@state`/`@action`/`@computed`/`@effect` and `defineModule()` write the
same metadata into the same record. The runtime treats them identically, so teams
without a decorator-capable toolchain lose nothing. See [Modules](./modules.md).

### One observable store

All module state lives in a single Coaction store, keyed by module name. App-level
patches, persistence, devtools, and selectors all operate over the whole app at
once. (Per-module isolated stores are an explicitly deferred idea.) See
[State & Reactivity](./state-and-reactivity.md).

### Single composition entry

There is one composition entry: `createApp({ providers })`. `@module` is the
marker that promotes a provider entry into a stateful CoSystem module. There is
deliberately no separate `modules` array.

### Rendering stays native

Adapters expose a framework-neutral reactive runtime (`getModule`, `watch`) and
let each framework consume it idiomatically — React hooks, Vue composables,
Svelte stores/runes, Solid signals, Angular signals. See
[UI Adapters](./ui-adapters.md).

### Everything optional is a plugin

Routing, persistence, and devtools are plugins, not core features. The core stays
small and embeddable; capabilities are added by composition. See
[Plugins](./plugins.md).

## Resolution and lifecycle, briefly

`createApp()` normalizes providers, applies any test overrides, freezes the
provider graph, instantiates eager `@module` providers, binds their state to a
freshly built store, runs eager providers and plugin `setup`, then runs `onInit`
and starts effects. `start()` runs `onStart`; `stop()`/`dispose()` tear down in
reverse order. Lazy modules load into isolated child scopes without mutating the
root graph. Full detail: [Application Lifecycle](./application-lifecycle.md).

## What is intentionally out of scope

CoSystem is not a rendering layer, a router framework, a full-stack server, a
build system, a component library, or a Next/Nuxt/SvelteKit replacement. It does
not provide a universal component abstraction or cross-framework templates. These
omissions are what keep it embeddable. See
[Introduction](./introduction.md#what-cosystem-is-not).

## Risks the design accounts for

- **Decorator portability** — mitigated by the no-decorator API, a WeakMap
  metadata fallback, and avoiding parameter decorators.
- **OO/DI acceptance** — mitigated by keeping the API optional and adapters
  framework-native; no one subclasses a framework base class.
- **Adapter maintenance** — mitigated by a small reactive-runtime contract that
  each framework wraps with its own primitives.
- **Scope creep** — mitigated by treating routing/persistence/devtools as
  plugins and keeping the core embeddable.

## Monorepo & tooling

The repository is a pnpm-workspace + Turborepo monorepo using Oxlint/Oxfmt,
Vitest (V8 coverage), tsdown (Rolldown) builds, Changesets for releases, and
Commitizen/commitlint/Husky/lint-staged for commit hygiene. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Next

- [Introduction](./introduction.md) — positioning and mental model.
- [Dependency Injection](./dependency-injection.md) — the resolver model in full.

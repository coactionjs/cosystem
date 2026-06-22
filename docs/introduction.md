# Introduction

CoSystem is a **UI-agnostic application meta-framework** built on top of
[Coaction](https://www.npmjs.com/package/coaction). It gives you a typed
application core — dependency injection, object-oriented stateful modules,
lifecycle, plugins, testing, and worker execution — without binding your
business logic to any one UI framework.

## The one-line pitch

> **The meta-framework for coexisting UI frameworks.**

The value is not "write one UI for every framework." It is:

> Write business modules once. Run them with React, Vue, Svelte, Solid, Angular,
> vanilla JS, workers, shared tabs, and tests.

## What CoSystem is

- An **embeddable application runtime** for business logic, dependency
  injection, stateful modules, lifecycle, worker execution, and cross-runtime
  state synchronization.
- A **programming model** inspired by Reactant — state, actions, computed
  values, DI, lifecycle, plugins, and testing — without Reactant's React/Redux
  coupling.
- A set of **framework-native adapters** that expose your modules to React
  hooks, Vue composables, Svelte stores/runes, Solid signals, and Angular
  signals.

## What CoSystem is not

CoSystem is **not** a replacement for Next.js, Nuxt, SvelteKit, Angular, or
Vite. It deliberately does not provide:

- A universal component abstraction or cross-framework template syntax.
- A rendering or mounting layer — there is no `render()`, `bootstrap()`,
  `ViewModule`, or root component base class. Rendering stays native to each
  framework.
- File-based routing, a full-stack server framework, a build/deploy system, or
  a UI component library.
- Reflection-based DI (`reflect-metadata` / `emitDecoratorMetadata`) or
  automatic constructor-type injection.

Routing, persistence, and devtools exist, but as **plugins** — never baked into
the core.

## The mental model

A CoSystem app is a graph of **modules** wired by a small **DI container**. Each
module is a plain class:

```ts
class Counter {
  count = 0; // state
  get double() {
    // computed
    return this.count * 2;
  }
  increase(step = 1) {
    // action
    this.count += step;
  }
}
```

The runtime merges every module's state into a **single observable store**:

```ts
app.store.getPureState();
// { counter: { count: 2 }, todos: { items: [] } }
```

UI adapters read that store with each framework's native reactivity. The same
`Counter` can drive a React component, a Vue component, or run inside a Web
Worker — the business logic never changes.

```txt
Application code
  │ uses
  ▼
@cosystem/core ──────────────── createApp(), DI, modules, store, lifecycle, plugins
  │ uses
  ▼
coaction ────────────────────── signals, computed caching, mutative updates, transport/worker sync
  │ consumed by
  ▼
@cosystem/react · @cosystem/vue · @cosystem/svelte · @cosystem/solid · @cosystem/angular
```

The core runtime never imports a UI framework, and it never mounts UI. Coaction
is a powerful implementation dependency — "powered by Coaction" — not a required
part of your mental model.

## When should you reach for CoSystem?

CoSystem shines when:

- Your **domain logic is non-trivial** and you want it decoupled from the view.
- You need the **same logic across multiple frameworks** (a design-system team,
  a migration from one framework to another, micro-frontends).
- You want to **move work off the main thread** (Web Worker) or **coordinate
  state across tabs** without rewriting your modules.
- You value **testability**: plain classes with injected dependencies and a
  first-class `testApp()`.

It is intentionally optional and incremental. You can adopt it for one feature
module and keep the rest of your app as-is.

## Next steps

- [Getting Started](./getting-started.md) — build and run your first app.
- [Core Concepts](./core-concepts.md) — the module model in depth.
- [Architecture](./architecture.md) — design principles and the Coaction boundary.

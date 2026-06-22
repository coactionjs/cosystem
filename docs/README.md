# CoSystem Documentation

> CoSystem — the meta-framework for coexisting UI frameworks. Write business
> modules once; run them with React, Vue, Svelte, Solid, Angular, vanilla JS,
> workers, shared tabs, and tests.

This directory contains the conceptual guides. For per-package API references,
see each package's README (linked from the root [Packages](../README.md#packages)
table). For runnable demos, see [`examples/`](../examples).

## Start here

1. [Introduction](./introduction.md) — what CoSystem is, how it is positioned,
   and the mental model.
2. [Getting Started](./getting-started.md) — install, scaffold, and build your
   first app with a UI framework.
3. [Core Concepts](./core-concepts.md) — modules, state, actions, computed,
   effects, and the single app store.

## Guides

| Guide                                               | What it covers                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Core Concepts](./core-concepts.md)                 | The module model and the one observable state tree.                               |
| [Modules](./modules.md)                             | Decorators vs `defineModule()`, metadata, binding, lifecycle hooks.               |
| [Dependency Injection](./dependency-injection.md)   | Tokens, providers, `deps`, scopes, lifetime safety, `inject()`, disposal.         |
| [Application Lifecycle](./application-lifecycle.md) | `createApp()` options, init/start/stop/dispose, lazy modules, scopes.             |
| [State & Reactivity](./state-and-reactivity.md)     | Coaction integration, the store, `watch`, strict actions, `runInAction`, patches. |
| [UI Adapters](./ui-adapters.md)                     | The adapter contract and a per-framework comparison.                              |
| [Plugins](./plugins.md)                             | The plugin interface, built-in plugins, and writing your own.                     |
| [Worker & Shared Runtime](./worker-runtime.md)      | Hosting modules off-thread and consuming them reactively.                         |
| [Testing](./testing.md)                             | `testApp()`, the inspector, and common patterns.                                  |

## Background

| Document                          | What it covers                                                      |
| --------------------------------- | ------------------------------------------------------------------- |
| [Architecture](./architecture.md) | High-level architecture, package boundaries, and design principles. |
| [FAQ](./faq.md)                   | Decorators, the OO model, strict mode, and other common questions.  |

## Conventions in these docs

- Code samples use `@cosystem/core` imports unless a UI adapter is shown.
- The recurring `Counter` example is the same one used across [`examples/`](../examples),
  so you can map a guide to a runnable project.
- "The store" always means the single Coaction-backed app store — CoSystem does
  not create one store per module.

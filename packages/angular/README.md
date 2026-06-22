# @cosystem/angular

> Angular bindings for [CoSystem](../../README.md): an environment provider and
> `inject*` helpers that expose a CoSystem app (or a worker-hosted app) as
> Angular signals.

## Installation

```sh
pnpm add @cosystem/angular @cosystem/core
```

Peer dependencies: `@angular/core` `>=17 <23`, `rxjs` `>=7.5 <8`.

## Quick start

Register the app with `provideCoSystem(app)` during bootstrap, then inject the
module and signals inside components.

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (module) => module.count);
}

bootstrapApplication(CounterView, {
  providers: [provideCoSystem(app)],
});
```

`injectSignal` returns a read-only Angular `Signal<T>` — call it (`count()`) in
the template.

## API

| Function                         | Returns                | Description                     |
| -------------------------------- | ---------------------- | ------------------------------- |
| `provideCoSystem(app)`           | `EnvironmentProviders` | Register the app for DI.        |
| `injectCoSystemApp()`            | `App`                  | Inject the app.                 |
| `injectModule(token)`            | `T`                    | Inject the bound module facade. |
| `injectSignal(fn, opts?)`        | `Signal<T>`            | Signal for `fn(app)`.           |
| `injectSignal(token, fn, opts?)` | `Signal<TValue>`       | Signal for `fn(module, app)`.   |

`injectSignal` accepts `{ equals }` (defaults to `Object.is`) and unsubscribes
automatically through `DestroyRef`. It must run in an injection context.

## Worker-hosted state

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { injectWorkerModule, injectWorkerSignal, provideWorkerClient } from "@cosystem/angular";

type CounterState = { readonly counter: { readonly count: number } };

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class WorkerCounterView {
  readonly counter = injectWorkerModule<Counter>("counter");
  readonly count = injectWorkerSignal((state) => (state as CounterState).counter.count);
}

bootstrapApplication(WorkerCounterView, {
  providers: [provideWorkerClient(client)],
});
```

- `provideWorkerClient(client)` → `EnvironmentProviders`.
- `injectWorkerClient()` → the `WorkerClient`.
- `injectWorkerModule<T>(name)` → an `AsyncMethodProxy<T>`.
- `injectWorkerSignal(fn, opts?)` → a `Signal<T>` of worker state.

## Exports

`provideCoSystem`, `provideWorkerClient`, the `COSYSTEM_APP` /
`COSYSTEM_WORKER_CLIENT` injection tokens, `injectCoSystemApp`, `injectModule`,
`injectSignal`, `injectWorkerClient`, `injectWorkerModule`, `injectWorkerSignal`,
and the `InjectSignalOptions`, `AppSelector`, `ModuleSelector` types.

## License

[MIT](../../LICENSE) © Coaction

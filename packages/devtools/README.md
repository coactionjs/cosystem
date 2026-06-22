# @cosystem/devtools

> Timeline inspection plugin for [CoSystem](../../README.md): records a
> chronological log of app setup, module creation, actions, patches, state
> changes, and errors for development tooling.

This is a headless data source — it records events and lets you subscribe to or
read the timeline. Build your own UI on top, or pipe it into logging.

## Installation

```sh
pnpm add -D @cosystem/devtools
```

## Quick start

```ts
import { createApp } from "@cosystem/core";
import { createDevtoolsPlugin } from "@cosystem/devtools";

const devtools = createDevtoolsPlugin();

const app = createApp({
  plugins: [devtools],
  providers: [Counter],
});

const unsubscribe = devtools.subscribe((event) => {
  console.log(event.type, event.time);
});

console.log(devtools.getTimeline());
unsubscribe();
```

## Options

| Option      | Type           | Default    | Description                                            |
| ----------- | -------------- | ---------- | ------------------------------------------------------ |
| `maxEvents` | `number`       | `1000`     | Ring-buffer size; oldest events are dropped past this. |
| `now`       | `() => number` | `Date.now` | Clock used for the `time` stamp on every event.        |

## Timeline events

Each entry is a `DevtoolsTimelineEvent` with a `type` and a `time`:

| `type`                            | Payload                         |
| --------------------------------- | ------------------------------- |
| `"setup"`                         | `{ app }`                       |
| `"module"`                        | `{ event: ModuleCreatedEvent }` |
| `"action:start"` / `"action:end"` | `{ event: ActionEvent }`        |
| `"patch"`                         | `{ event: PatchEvent }`         |
| `"state"`                         | `{ event: StateChangeEvent }`   |
| `"error"`                         | `{ error, context }`            |

## Plugin methods

```ts
devtools.getTimeline(); // readonly snapshot of recorded events
devtools.subscribe(listener); // → unsubscribe; fires on each new event
devtools.clearTimeline(); // reset the buffer
```

## Exports

`createDevtoolsPlugin`, and the `DevtoolsPlugin`, `DevtoolsOptions`,
`DevtoolsTimelineEvent`, `DevtoolsTimelineListener` types.

## License

[MIT](../../LICENSE) © Coaction

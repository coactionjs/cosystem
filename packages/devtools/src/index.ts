import type {
  ActionEvent,
  App,
  ErrorContext,
  ModuleCreatedEvent,
  PatchEvent,
  Plugin,
  StateChangeEvent,
} from "@cosystem/core";

export type DevtoolsTimelineEvent =
  | {
      readonly type: "setup";
      readonly app: App;
      readonly time: number;
    }
  | {
      readonly type: "action:start" | "action:end";
      readonly event: ActionEvent;
      readonly time: number;
    }
  | {
      readonly type: "module";
      readonly event: ModuleCreatedEvent;
      readonly time: number;
    }
  | {
      readonly type: "patch";
      readonly event: PatchEvent;
      readonly time: number;
    }
  | {
      readonly type: "state";
      readonly event: StateChangeEvent;
      readonly time: number;
    }
  | {
      readonly type: "error";
      readonly error: unknown;
      readonly context: ErrorContext;
      readonly time: number;
    };

export interface DevtoolsPlugin extends Plugin {
  getTimeline(): readonly DevtoolsTimelineEvent[];
  subscribe(listener: DevtoolsTimelineListener): () => void;
  clearTimeline(): void;
}

export type DevtoolsTimelineListener = (event: DevtoolsTimelineEvent) => void;

export interface DevtoolsOptions {
  readonly maxEvents?: number;
  readonly now?: () => number;
}

export function createDevtoolsPlugin(options: DevtoolsOptions = {}): DevtoolsPlugin {
  const timeline: DevtoolsTimelineEvent[] = [];
  const listeners = new Set<DevtoolsTimelineListener>();
  const maxEvents = options.maxEvents ?? 1_000;
  const now = options.now ?? Date.now;

  const push = (event: DevtoolsTimelineEvent): void => {
    timeline.push(event);

    if (timeline.length > maxEvents) {
      timeline.splice(0, timeline.length - maxEvents);
    }

    for (const listener of listeners) {
      listener(event);
    }
  };

  return {
    name: "cosystem:devtools",
    clearTimeline() {
      timeline.length = 0;
    },
    getTimeline() {
      return [...timeline];
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    onActionEnd(event) {
      push({
        event,
        time: now(),
        type: "action:end",
      });
    },
    onActionStart(event) {
      push({
        event,
        time: now(),
        type: "action:start",
      });
    },
    onError(error, context) {
      push({
        context,
        error,
        time: now(),
        type: "error",
      });
    },
    onModuleCreated(event) {
      push({
        event,
        time: now(),
        type: "module",
      });
    },
    onPatch(event) {
      push({
        event,
        time: now(),
        type: "patch",
      });
    },
    onStateChange(event) {
      push({
        event,
        time: now(),
        type: "state",
      });
    },
    setup(app) {
      push({
        app,
        time: now(),
        type: "setup",
      });
    },
  };
}

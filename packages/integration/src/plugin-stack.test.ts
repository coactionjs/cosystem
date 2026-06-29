import { describe, expect, it } from "vitest";

import { createApp, defineModule, type App } from "@cosystem/core";
import { createDevtoolsPlugin } from "@cosystem/devtools";
import { createMemoryRouter, createRouterPlugin } from "@cosystem/router";
import {
  createLocalSpaceStorage,
  createLocalSpaceStoragePlugin,
  type StorageService,
} from "@cosystem/storage";

interface ShellState {
  readonly shell: {
    readonly count: number;
    readonly path: string;
  };
}

class Shell {
  count = 0;
  path = "/";

  increase(): number {
    this.count += 1;
    return this.count;
  }
}

defineModule(Shell, {
  actions: ["increase"],
  name: "shell",
  state: ["count", "path"],
});

describe("plugin stack integration", () => {
  it("hydrates, observes, routes, persists, and rehydrates a composed app", async () => {
    const storage = createLocalSpaceStorage({
      options: createMemoryLocalSpaceOptions("plugin-stack"),
    });

    try {
      await storage.set("app", {
        shell: {
          count: 2,
          path: "/persisted",
        },
      } satisfies ShellState);

      const first = await startIntegratedApp(storage);

      expect(first.app.getModule(Shell).count).toBe(2);
      expect(first.app.getModule(Shell).path).toBe("/persisted");
      expect(first.devtools.getTimeline().map((event) => event.type)).toContain("setup");

      first.router.navigate("/settings?tab=security#advanced");
      expect(first.app.getModule(Shell).path).toBe("/settings");
      expect(first.app.getModule(Shell).increase()).toBe(3);
      await first.storagePlugin.flush();

      expect(await storage.get<ShellState>("app")).toEqual({
        shell: {
          count: 3,
          path: "/settings",
        },
      });
      expect(first.devtools.getTimeline().map((event) => event.type)).toEqual(
        expect.arrayContaining(["action:start", "action:end", "patch", "state"]),
      );

      await first.app.dispose();

      const second = await startIntegratedApp(storage);

      expect(second.app.getModule(Shell).count).toBe(3);
      expect(second.app.getModule(Shell).path).toBe("/settings");

      await second.app.dispose();
    } finally {
      await storage.destroy();
    }
  });
});

async function startIntegratedApp(storage: StorageService): Promise<{
  readonly app: App;
  readonly devtools: ReturnType<typeof createDevtoolsPlugin>;
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly storagePlugin: ReturnType<typeof createLocalSpaceStoragePlugin<ShellState>>;
}> {
  const router = createMemoryRouter();
  const devtools = createDevtoolsPlugin();
  const storagePlugin = createLocalSpaceStoragePlugin<ShellState>({
    key: "app",
    merge: mergeShellState,
    service: storage,
  });
  const app = createApp({
    plugins: [
      devtools,
      storagePlugin,
      createRouterPlugin(router, {
        onChange(location, runtime) {
          runtime.runInAction(
            Shell,
            () => {
              runtime.getModule(Shell).path = location.path;
            },
            {
              name: "router.navigate",
            },
          );
        },
      }),
    ],
    providers: [Shell],
  });

  await app.start();

  return {
    app,
    devtools,
    router,
    storagePlugin,
  };
}

function mergeShellState(persisted: ShellState, current: unknown): ShellState {
  const currentShell = (current as Partial<ShellState>).shell;

  return {
    shell: {
      count: persisted.shell.count,
      path: persisted.shell.path ?? currentShell?.path ?? "/",
    },
  };
}

function createMemoryLocalSpaceOptions(suffix: string) {
  return {
    driver: "memoryStorageWrapper",
    name: `cosystem-integration-${suffix}`,
    storeName: "state",
  };
}

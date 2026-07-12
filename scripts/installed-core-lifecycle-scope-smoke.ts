#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-core-lifecycle-scope-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject(coreTarball, catalog);
  await run(
    "pnpm",
    ["install", "--prefer-offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed core lifecycle and provider scopes.");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function packPackage(name) {
  const packageDir = join(packagesDir, name.slice("@cosystem/".length));
  const destination = join(tarballsDir, name.replaceAll("@", "").replaceAll("/", "__"));

  await mkdir(destination, { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", destination], packageDir);

  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`${name} must produce exactly one tarball.`);
  }

  return join(destination, tarballs[0]);
}

async function writeConsumerProject(coreTarball, catalog) {
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-core-lifecycle-scope-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
        },
        devDependencies: {
          typescript: readCatalogVersion(catalog, "typescript"),
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(consumerDir, "pnpm-lock.yaml"), await readFile(lockfilePath, "utf8"));
  await writeFile(
    join(consumerDir, "pnpm-workspace.yaml"),
    [
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2023"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(consumerDir, "index.ts"), createTypeConsumerSource());
  await writeFile(join(consumerDir, "runtime.mjs"), createRuntimeConsumerSource());
}

function createTypeConsumerSource() {
  return `import {
  createApp,
  createContainer,
  defineModule,
  provide,
  token,
  type App,
  type Plugin,
} from "@cosystem/core";

class TypeModule {
  value = 0;

  increase(): number {
    this.value += 1;
    return this.value;
  }
}

defineModule(TypeModule, {
  actions: ["increase"],
  name: "typeModule",
  state: ["value"],
});

class ScopedService {
  readonly id = Symbol("scoped");
}

const MultiToken = token<string>("MultiToken");
const app: App = createApp({
  plugins: [
    {
      name: "typePlugin",
      setup(instance: App, context): void {
        void instance;
        void context.inject(TypeModule);
      },
    } satisfies Plugin,
  ],
  providers: [
    TypeModule,
    provide(ScopedService, {
      scope: "scoped",
      useClass: ScopedService,
    }),
    provide(MultiToken, {
      multi: true,
      useValue: "first",
    }),
    provide(MultiToken, {
      multi: true,
      useValue: "second",
    }),
  ],
});
const scope = app.createScope();
const container = createContainer({ strictScopes: false });
const ready: Promise<void> = app.ready;

container.provide(ScopedService);

void [ready, app.getAll(MultiToken), scope.container.get(ScopedService), container.get(ScopedService)];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  createApp,
  createContainer,
  defineModule,
  provide,
  token,
} from "@cosystem/core";

const events = [];
const disposeEvents = [];
const MultiToken = token("MultiToken");
const EagerToken = token("EagerToken");
const LifecycleEventToken = token("LifecycleEventToken");

class LifecycleModule {
  value = 0;

  increase(step = 1) {
    this.value += step;
    return this.value;
  }

  async onInit(context) {
    await Promise.resolve();
    context.inject(LifecycleEventToken)("module:init");
  }

  async onStart(context) {
    await Promise.resolve();
    context.inject(LifecycleEventToken)("module:start");
  }

  async onStop(context) {
    await Promise.resolve();
    context.inject(LifecycleEventToken)("module:stop");
  }

  async onDispose(context) {
    await Promise.resolve();
    context.inject(LifecycleEventToken)("module:dispose");
  }
}

defineModule(LifecycleModule, {
  actions: ["increase"],
  name: "lifecycle",
  state: ["value"],
});

class ScopedService {
  constructor() {
    this.id = Symbol("scoped");
  }
}

class TransientService {
  constructor() {
    this.id = Symbol("transient");
  }
}

class ResolutionService {
  constructor() {
    this.id = Symbol("resolution");
  }
}

class UsesResolution {
  constructor(first, second) {
    this.first = first;
    this.second = second;
  }
}

const app = createApp({
  plugins: [
    {
      name: "lifecyclePlugin",
      onModuleCreated(event, context) {
        events.push("created:" + context.name + ":" + event.name);
      },
      async setup(runtimeApp, context) {
        events.push("plugin:setup:" + context.name);
        await Promise.resolve();
        context.inject(LifecycleEventToken)("plugin:inject");
        await runtimeApp.start().catch((error) => {
          events.push("plugin:start-rejected:" + error.message);
        });
        context.onDispose(() => {
          events.push("plugin:onDispose");
        });
      },
      dispose(context) {
        events.push("plugin:dispose:" + context.name);
      },
    },
  ],
  providers: [
    LifecycleModule,
    provide(LifecycleEventToken, {
      useValue(event) {
        events.push(event);
      },
    }),
    provide(ScopedService, {
      dispose(value) {
        disposeEvents.push("scoped:" + String(value.id));
      },
      scope: "scoped",
      useClass: ScopedService,
    }),
    provide(MultiToken, {
      multi: true,
      useValue: "first",
    }),
    provide(MultiToken, {
      multi: true,
      useValue: "second",
    }),
    provide(EagerToken, {
      dispose(value) {
        disposeEvents.push("eager:" + value.id);
      },
      eager: true,
      useFactory() {
        return { id: "ready" };
      },
    }),
  ],
});

const ready = app.ready;
expectSame(app.ready, ready, "app readiness promise is stable");
await app.start();
await ready;
const lifecycleModule = app.getModule(LifecycleModule);
expectEqual(lifecycleModule.increase(2), 2, "module action returns updated value");
expectEqual(app.get(LifecycleModule).value, 2, "module state is mutated through action");
expectArrayEqual(app.getAll(MultiToken), ["first", "second"], "multi provider order");
expectEqual(app.get(EagerToken).id, "ready", "eager provider value");

const firstScope = app.createScope();
const secondScope = app.createScope();
const firstScopedA = firstScope.container.get(ScopedService);
const firstScopedB = firstScope.container.get(ScopedService);
const secondScoped = secondScope.container.get(ScopedService);

expectSame(firstScopedA, firstScopedB, "scoped provider is reused in one scope");
expectNotSame(firstScopedA, secondScoped, "scoped provider is isolated between scopes");

const container = createContainer({ strictScopes: false });

container.provide(
  provide(TransientService, {
    dispose(value) {
      disposeEvents.push("transient:" + String(value.id));
    },
    scope: "transient",
    useClass: TransientService,
  }),
);
container.provide(
  provide(ResolutionService, {
    dispose(value) {
      disposeEvents.push("resolution:" + String(value.id));
    },
    scope: "resolution",
    useClass: ResolutionService,
  }),
);
container.provide(
  provide(UsesResolution, {
    deps: [ResolutionService, ResolutionService],
    scope: "resolution",
    useClass: UsesResolution,
  }),
);

expectNotSame(
  container.get(TransientService),
  container.get(TransientService),
  "transient provider creates a fresh value per lookup",
);

const usesResolution = container.get(UsesResolution);

expectSame(
  usesResolution.first,
  usesResolution.second,
  "resolution provider is shared within one dependency graph",
);
expectNotSame(
  container.get(ResolutionService),
  container.get(ResolutionService),
  "resolution provider is not cached across top-level lookups",
);

await container.dispose();
await firstScope.container.dispose();
await secondScope.container.dispose();
await app.stop();
await app.dispose();

expectThrows(
  () => lifecycleModule.increase(),
  "Cannot run module actions after app disposal has begun.",
  "retained module actions are terminal",
);
expectThrows(
  () => app.getModule(LifecycleModule),
  "Cannot access modules after app disposal has begun.",
  "module lookup is terminal",
);

expectArrayEqual(
  events,
  [
    "created:lifecyclePlugin:lifecycle",
    "plugin:setup:lifecyclePlugin",
    "plugin:inject",
    "plugin:start-rejected:Cannot call start() from app-managed setup work.",
    "module:init",
    "module:start",
    "module:stop",
    "module:dispose",
    "plugin:dispose:lifecyclePlugin",
    "plugin:onDispose",
  ],
  "lifecycle and plugin event order",
);
expectIncludes(disposeEvents, "eager:ready", "eager provider is disposed");
expectEqual(
  disposeEvents.filter((event) => event.startsWith("scoped:")).length,
  2,
  "created app scopes are disposed by their containers",
);
expectEqual(
  disposeEvents.filter((event) => event.startsWith("transient:")).length,
  2,
  "transient instances are disposed by their container",
);
expectEqual(
  disposeEvents.filter((event) => event.startsWith("resolution:")).length,
  3,
  "resolution instances are disposed by their container",
);

function expectEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}

function expectSame(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(label + ": expected references to match");
  }
}

function expectNotSame(actual, expected, label) {
  if (actual === expected) {
    throw new Error(label + ": expected references to differ");
  }
}

function expectArrayEqual(actual, expected, label) {
  if (actual.length !== expected.length) {
    throw new Error(
      label + ": expected length " + String(expected.length) + ", got " + String(actual.length),
    );
  }

  for (const [index, value] of actual.entries()) {
    if (!Object.is(value, expected[index])) {
      throw new Error(
        label +
          ": expected index " +
          String(index) +
          " to be " +
          String(expected[index]) +
          ", got " +
          String(value),
      );
    }
  }
}

function expectIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(label + ": missing " + expected + " in " + values.join(", "));
  }
}

function expectThrows(callback, expectedMessage, label) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) {
      return;
    }

    throw new Error(label + ": unexpected error " + String(error));
  }

  throw new Error(label + ": expected an error");
}
`;
}

async function readCatalog() {
  const workspaceYaml = await readFile(workspacePath, "utf8");
  const catalog = new Map();
  let inCatalog = false;
  let catalogIndent = 0;

  for (const line of workspaceYaml.split("\n")) {
    if (/^\s*catalog:\s*$/.test(line)) {
      inCatalog = true;
      catalogIndent = line.match(/^\s*/)?.[0].length ?? 0;
      continue;
    }

    if (!inCatalog || line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= catalogIndent) {
      break;
    }

    const match = line.match(/^\s*(?:"([^"]+)"|([^:]+)):\s*(?:"([^"]+)"|(.+))\s*$/);

    if (match !== null) {
      const name = match[1] ?? match[2]?.trim();
      const version = match[3] ?? match[4]?.trim();

      if (name !== undefined && version !== undefined) {
        catalog.set(name, version);
      }
    }
  }

  return catalog;
}

function readCatalogVersion(catalog, name) {
  const version = catalog.get(name);

  if (version === undefined) {
    throw new Error(`${name} is missing from pnpm-workspace.yaml catalog.`);
  }

  return version;
}

async function run(command, args, cwd) {
  try {
    await execFileAsync(command, args, {
      cwd,
      env: {
        ...process.env,
        npm_config_registry: process.env.npm_config_registry ?? "https://registry.npmjs.org/",
      },
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch (error) {
    const stdout = error.stdout === undefined ? "" : `\nstdout:\n${error.stdout}`;
    const stderr = error.stderr === undefined ? "" : `\nstderr:\n${error.stderr}`;

    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}.${stdout}${stderr}`, {
      cause: error,
    });
  }
}

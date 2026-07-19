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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-core-async-lazy-"));
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

  console.log("Verified installed core async providers and lazy modules.");
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
        name: "cosystem-core-async-lazy-smoke",
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
      "minimumReleaseAgeExclude:",
      `  - ${JSON.stringify(`coaction@${readCatalogVersion(catalog, "coaction")}`)}`,
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
  AsyncProviderInSyncResolutionError,
  createApp,
  createContainer,
  defineModule,
  lazyModule,
  provide,
  token,
  type App,
  type LazyModuleLoadResult,
} from "@cosystem/core";

const AsyncToken = token<string>("AsyncToken");

class TypeLazyModule {
  count = 1;

  increase(): number {
    this.count += 1;
    return this.count;
  }
}

defineModule(TypeLazyModule, {
  actions: ["increase"],
  name: "typeLazyModule",
  state: ["count"],
});

const container = createContainer();

container.provide(
  provide(AsyncToken, {
    useFactory: async () => "ready",
  }),
);

try {
  container.get(AsyncToken);
} catch (error) {
  if (!(error instanceof AsyncProviderInSyncResolutionError)) {
    throw error;
  }
}

const value: string = await container.getAsync(AsyncToken);
const app: App = createApp({
  providers: [
    lazyModule(async () => ({
      providers: [TypeLazyModule],
    })),
  ],
});
const results: readonly LazyModuleLoadResult[] = await app.load();

void [app, results, value];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  AsyncProviderInSyncResolutionError,
  CosystemError,
  createApp,
  createContainer,
  defineModule,
  lazyModule,
  provide,
  token,
} from "@cosystem/core";

const SyncErrorToken = token("SyncErrorToken");
const AsyncValueToken = token("AsyncValueToken");
const BuildErrorToken = token("BuildErrorToken");
const AppSyncErrorToken = token("AppSyncErrorToken");
const AppAsyncToken = token("AppAsyncToken");
const LazyResourceToken = token("LazyResourceToken");

class AsyncBuilt {
  constructor(value) {
    this.value = value;
  }
}

class RootCounter {
  constructor() {
    this.count = 0;
  }

  increase() {
    this.count += 1;
    return this.count;
  }
}

defineModule(RootCounter, {
  actions: ["increase"],
  name: "rootCounter",
  state: ["count"],
});

class LazyCounter {
  constructor() {
    this.count = 1;
  }

  get double() {
    return this.count * 2;
  }

  increase(step = 1) {
    this.count += step;
    return this.count;
  }

  onInit() {
    lazyEvents.push("init");
  }

  onStart() {
    lazyEvents.push("start");
  }

  onStop() {
    lazyEvents.push("stop");
  }

  onDispose() {
    lazyEvents.push("dispose");
  }
}

defineModule(LazyCounter, {
  actions: ["increase"],
  computed: ["double"],
  name: "lazyCounter",
  state: ["count"],
});

class BrokenLazyEffect {
  constructor() {
    this.value = 1;
  }

  explode() {
    throw new Error("installed lazy effect boom");
  }
}

defineModule(BrokenLazyEffect, {
  effects: ["explode"],
  name: "brokenLazyEffect",
  state: ["value"],
});

const container = createContainer();

container.provide(
  provide(SyncErrorToken, {
    useFactory: async () => "sync-error",
  }),
);
expectThrowsInstance(
  () => container.get(SyncErrorToken),
  AsyncProviderInSyncResolutionError,
  "sync container get rejects async providers",
);

let asyncValueCalls = 0;
container.provide(
  provide(AsyncValueToken, {
    useFactory: async () => {
      asyncValueCalls += 1;
      await tick();
      return { id: "container-ready" };
    },
  }),
);
const firstAsyncValue = await container.getAsync(AsyncValueToken);
const secondAsyncValue = await container.getAsync(AsyncValueToken);

expectSame(firstAsyncValue, secondAsyncValue, "async provider is cached after getAsync");
expectEqual(asyncValueCalls, 1, "async provider factory runs once after cache");

container.provide(
  provide(BuildErrorToken, {
    useFactory: async () => ({ id: "build-ready" }),
  }),
);
expectThrowsInstance(
  () => container.build(AsyncBuilt, { deps: [BuildErrorToken] }),
  AsyncProviderInSyncResolutionError,
  "sync build rejects async dependencies",
);
const built = await container.buildAsync(AsyncBuilt, { deps: [BuildErrorToken] });

expectEqual(built.value.id, "build-ready", "buildAsync resolves async dependencies");

const createdModules = [];
const lazyEvents = [];
let appAsyncCalls = 0;
let lazyLoadCalls = 0;

const pendingLazyModule = lazyModule(async () => {
  lazyLoadCalls += 1;
  lazyEvents.push("load");
  await tick();

  return {
    providers: [
      LazyCounter,
      provide(LazyResourceToken, {
        dispose(value) {
          lazyEvents.push("resource:dispose:" + value.id);
        },
        eager: true,
        useFactory() {
          lazyEvents.push("resource:create");
          return { id: "lazy-resource" };
        },
      }),
    ],
  };
});

const app = createApp({
  plugins: [
    {
      onModuleCreated(event) {
        createdModules.push(event.name);
      },
    },
  ],
  providers: [
    RootCounter,
    provide(AppSyncErrorToken, {
      useFactory: async () => "sync-error",
    }),
    provide(AppAsyncToken, {
      useFactory: async () => {
        appAsyncCalls += 1;
        await tick();
        return { id: "app-ready" };
      },
    }),
    pendingLazyModule,
  ],
});

await app.start();
const failedLazySnapshots = [];
const versionBeforeFailedLazyLoad = app.state.version;
const stopFailedLazyWatch = app.store.subscribe(() => {
  failedLazySnapshots.push(app.store.getPureState());
});

await expectRejects(
  app.load(lazyModule(() => BrokenLazyEffect)),
  "installed lazy effect boom",
  "failed lazy effect load",
);
stopFailedLazyWatch();
expectEqual(failedLazySnapshots.length, 0, "failed lazy load publishes no snapshots");
expectEqual(app.state.version, versionBeforeFailedLazyLoad, "failed lazy load preserves version");
expectEqual(
  Object.hasOwn(app.store.getPureState(), "brokenLazyEffect"),
  false,
  "failed lazy state stays hidden",
);
expectThrowsInstance(
  () => app.getModule(BrokenLazyEffect),
  CosystemError,
  "failed lazy module stays hidden",
);

expectThrowsInstance(
  () => app.get(AppSyncErrorToken),
  AsyncProviderInSyncResolutionError,
  "sync app get rejects async providers",
);
const firstAppAsyncValue = await app.getAsync(AppAsyncToken);
const secondAppAsyncValue = await app.getAsync(AppAsyncToken);

expectSame(firstAppAsyncValue, secondAppAsyncValue, "app async provider is cached after getAsync");
expectEqual(appAsyncCalls, 1, "app async provider factory runs once after cache");
expectThrowsInstance(
  () => app.getModule(LazyCounter),
  CosystemError,
  "lazy module is unavailable before load",
);

const lazyResults = await app.load();
const lazyResult = lazyResults[0];

expectEqual(lazyResults.length, 1, "pending lazy load returns one result");
expectEqual(lazyLoadCalls, 1, "lazy module loader runs once");
expectArrayEqual(createdModules, ["rootCounter", "lazyCounter"], "module creation hooks");
expectArrayEqual(lazyResult.modules.map((module) => module.name), ["lazyCounter"], "lazy modules");
expectEqual(
  lazyResult.scope.container.get(LazyResourceToken).id,
  "lazy-resource",
  "lazy scope exposes eager provider",
);
expectArrayEqual(
  lazyEvents,
  ["load", "resource:create", "init", "start"],
  "lazy load lifecycle before dispose",
);

const cachedLazyResult = await app.load(pendingLazyModule);

expectSame(cachedLazyResult, lazyResult, "explicit lazy load returns cached result");
expectEqual(lazyLoadCalls, 1, "cached lazy module does not reload");

const lazyCounter = app.getModule(LazyCounter);
const watchEvents = [];
const unwatch = app.watch(
  () => lazyCounter.double,
  (value, previous) => {
    watchEvents.push(String(previous) + "->" + String(value));
  },
  { immediate: true },
);

lazyCounter.increase(2);
expectEqual(lazyCounter.count, 3, "lazy action updates state");
expectArrayEqual(watchEvents, ["2->2", "2->6"], "lazy module watch updates");

unwatch();
await app.dispose();
await container.dispose();

expectArrayEqual(
  lazyEvents,
  [
    "load",
    "resource:create",
    "init",
    "start",
    "stop",
    "dispose",
    "resource:dispose:lazy-resource",
  ],
  "lazy lifecycle and scope disposal",
);

function tick() {
  return Promise.resolve();
}

async function expectRejects(promise, expectedMessage, label) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }

    throw new Error(label + ": expected " + expectedMessage + ", got " + formatError(error));
  }

  throw new Error(label + ": expected rejection");
}

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

function expectThrowsInstance(callback, ExpectedError, label) {
  try {
    callback();
  } catch (error) {
    if (error instanceof ExpectedError) {
      return error;
    }

    throw new Error(label + ": expected " + ExpectedError.name + ", got " + formatError(error));
  }

  throw new Error(label + ": expected " + ExpectedError.name + " to be thrown");
}

function formatError(error) {
  if (error instanceof Error) {
    return error.name + ": " + error.message;
  }

  return String(error);
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

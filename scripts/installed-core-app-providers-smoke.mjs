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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-core-app-providers-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject(coreTarball, catalog);
  await run("pnpm", ["install", "--offline", "--ignore-scripts"], consumerDir);
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed core app provider runtime.");
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
        name: "cosystem-core-app-providers-smoke",
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
  AsyncProviderInSyncResolutionError,
  createApp,
  defineModule,
  provide,
  token,
  type App,
} from "@cosystem/core";

interface TypeLogger {
  info(message: string): void;
}

class TypeMetadataLogger implements TypeLogger {
  readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }
}

class TypeProviderLogger extends TypeMetadataLogger {}

class TypeProviderCounter {
  count = 0;

  constructor(readonly logger: TypeLogger) {}

  increase(): number {
    this.count += 1;
    this.logger.info(String(this.count));
    return this.count;
  }
}

defineModule(TypeProviderCounter, {
  actions: ["increase"],
  deps: [TypeMetadataLogger],
  name: "typeProviderCounter",
  state: ["count"],
});

const ExtensionToken = token<{ readonly name: string }>("TypeExtension");
const AsyncToken = token<string>("TypeAsync");
const app: App = createApp({
  providers: [
    TypeMetadataLogger,
    TypeProviderLogger,
    provide(TypeProviderCounter, {
      deps: [TypeProviderLogger],
      useClass: TypeProviderCounter,
    }),
    provide(ExtensionToken, {
      eager: true,
      multi: true,
      useFactory: () => ({ name: "first" }),
    }),
    provide(ExtensionToken, {
      multi: true,
      useFactory: () => ({ name: "second" }),
    }),
  ],
});
const counter: TypeProviderCounter = app.getModule(TypeProviderCounter);
const extensions: Array<{ readonly name: string }> = app.getAll(ExtensionToken);

try {
  createApp({
    providers: [
      provide(AsyncToken, {
        eager: true,
        useFactory: async () => "ready",
      }),
    ],
  });
} catch (error) {
  if (!(error instanceof AsyncProviderInSyncResolutionError)) {
    throw error;
  }
}

void [counter.increase(), extensions];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  AsyncProviderInSyncResolutionError,
  createApp,
  defineModule,
  provide,
  token,
} from "@cosystem/core";

class MemoryLogger {
  constructor() {
    this.messages = [];
  }

  info(message) {
    this.messages.push(message);
  }
}

class MetadataLogger extends MemoryLogger {}
class ProviderLogger extends MemoryLogger {}

class ProviderOverrideCounter {
  constructor(logger) {
    this.count = 0;
    this.logger = logger;
  }

  increase() {
    this.count += 1;
    this.logger.info("count:" + String(this.count));
  }
}

defineModule(ProviderOverrideCounter, {
  actions: ["increase"],
  deps: [MetadataLogger],
  name: "providerOverrideCounter",
  state: ["count"],
});

await verifyProviderDepsOverride();
await verifyModuleFacadeScopes();
await verifyProviderEagerness();
await verifyParentAppResolution();

async function verifyProviderDepsOverride() {
  const app = createApp({
    providers: [
      MetadataLogger,
      ProviderLogger,
      provide(ProviderOverrideCounter, {
        deps: [ProviderLogger],
        useClass: ProviderOverrideCounter,
      }),
    ],
  });
  const counter = app.getModule(ProviderOverrideCounter);

  expectInstance(counter.logger, ProviderLogger, "provider-level deps override metadata deps");
  counter.increase();
  expectJsonEqual(counter.logger.messages, ["count:1"], "overridden logger receives action");
  expectJsonEqual(
    app.store.getPureState(),
    {
      providerOverrideCounter: {
        count: 1,
      },
    },
    "provider override module state",
  );

  await app.dispose();
}

async function verifyModuleFacadeScopes() {
  class TransientScopedCounter {
    constructor() {
      this.count = 0;
    }

    increase() {
      this.count += 1;
    }
  }

  defineModule(TransientScopedCounter, {
    actions: ["increase"],
    name: "transientScopedCounter",
    scope: "transient",
    state: ["count"],
  });

  const app = createApp({
    providers: [TransientScopedCounter],
  });
  const module = app.getModule(TransientScopedCounter);

  module.increase();

  expectSame(app.get(TransientScopedCounter), module, "sync app get returns bound module facade");
  expectSame(
    await app.getAsync(TransientScopedCounter),
    module,
    "async app get returns bound module facade",
  );
  expectEqual(app.get(TransientScopedCounter).count, 1, "bound module facade state");
  expectJsonEqual(
    app.store.getPureState(),
    {
      transientScopedCounter: {
        count: 1,
      },
    },
    "transient module state is app-bound",
  );

  await app.dispose();
}

async function verifyProviderEagerness() {
  const LazyToken = token("LazyToken");
  const events = [];

  class LazyService {
    constructor() {
      events.push("class");
      this.value = "class";
    }
  }

  const lazyApp = createApp({
    providers: [
      LazyService,
      provide(LazyToken, {
        useFactory: () => {
          events.push("factory");
          return { value: "factory" };
        },
      }),
    ],
  });

  expectJsonEqual(events, [], "non-module providers stay lazy");
  expectEqual(lazyApp.get(LazyService).value, "class", "lazy class provider resolves");
  expectEqual(lazyApp.get(LazyToken).value, "factory", "lazy factory provider resolves");
  expectJsonEqual(events, ["class", "factory"], "lazy providers instantiate on demand");

  await lazyApp.dispose();

  class EagerCounter {
    constructor() {
      this.count = 1;
    }
  }

  defineModule(EagerCounter, {
    name: "eagerCounter",
    state: ["count"],
  });

  class EagerReader {
    static inject = [EagerCounter];

    constructor(counter) {
      events.push("count:" + String(counter.count));
      counter.count = 3;
      this.counter = counter;
    }
  }

  const ExtensionToken = token("Extension");
  const asyncToken = token("AsyncEager");
  const eagerApp = createApp({
    providers: [
      EagerCounter,
      provide(EagerReader, {
        eager: true,
        useClass: EagerReader,
      }),
      provide(ExtensionToken, {
        eager: true,
        multi: true,
        useFactory: () => {
          events.push("first");
          return { name: "first" };
        },
      }),
      provide(ExtensionToken, {
        multi: true,
        useFactory: () => {
          events.push("second");
          return { name: "second" };
        },
      }),
    ],
  });

  expectIncludes(events, "count:1", "eager provider sees bound module state");
  expectEqual(eagerApp.getModule(EagerCounter).count, 3, "eager provider updates module facade");
  expectJsonEqual(
    eagerApp.store.getPureState(),
    {
      eagerCounter: {
        count: 3,
      },
    },
    "eager provider mutation is reflected in app state",
  );
  expectJsonEqual(
    eagerApp.getAll(ExtensionToken).map((extension) => extension.name),
    ["first", "second"],
    "eager multi provider group",
  );
  expectJsonEqual(
    events.filter((event) => event === "first" || event === "second"),
    ["first", "second"],
    "eager multi factories run in order",
  );
  expectThrowsInstance(
    () =>
      createApp({
        providers: [
          provide(asyncToken, {
            eager: true,
            useFactory: async () => "ready",
          }),
        ],
      }),
    AsyncProviderInSyncResolutionError,
    "async eager factory fails during sync app creation",
  );

  await eagerApp.dispose();
}

async function verifyParentAppResolution() {
  const LoggerToken = token("ParentLogger");

  class ChildCounter {
    static inject = [LoggerToken];

    constructor(logger) {
      this.count = 0;
      this.logger = logger;
    }

    increase() {
      this.count += 1;
      this.logger.info("child:" + String(this.count));
    }
  }

  defineModule(ChildCounter, {
    actions: ["increase"],
    name: "childCounter",
    state: ["count"],
  });

  const logger = new MemoryLogger();
  const parent = createApp({
    providers: [provide(LoggerToken, { useValue: logger })],
  });
  const child = createApp({
    parent,
    providers: [ChildCounter],
  });

  expectEqual("container" in parent, false, "root container stays private");

  child.getModule(ChildCounter).increase();

  expectJsonEqual(logger.messages, ["child:1"], "child resolves parent app providers");

  await child.dispose();
  await parent.dispose();
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

function expectInstance(actual, ExpectedClass, label) {
  if (!(actual instanceof ExpectedClass)) {
    throw new Error(label + ": expected " + ExpectedClass.name + ", got " + formatValue(actual));
  }
}

function expectIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(actual) + " to include " + expected);
  }
}

function expectJsonEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(label + ": expected " + expectedJson + ", got " + actualJson);
  }
}

function formatValue(value) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "object") {
    return value.constructor?.name ?? "object";
  }

  return String(value);
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
    if (match === null) {
      continue;
    }

    const name = match[1] ?? match[2]?.trim();
    const version = match[3] ?? match[4]?.trim();

    if (name !== undefined && version !== undefined) {
      catalog.set(name, version);
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

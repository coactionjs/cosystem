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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-core-container-"));
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

  console.log("Verified installed core container runtime.");
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
        name: "cosystem-core-container-smoke",
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
  createContainer,
  inject,
  provide,
  token,
  type ClassProvider,
  type ExistingProvider,
  type FactoryProvider,
  type ValueProvider,
} from "@cosystem/core";

interface TypeLogger {
  info(message: string): void;
}

class TypeConsoleLogger implements TypeLogger {
  info(_message: string): void {}
}

const LoggerToken = token<TypeLogger>("TypeLogger");
const AliasToken = token<TypeLogger>("TypeAliasLogger");
const SummaryToken = token<string>("TypeSummary");
const PluginToken = token<{ readonly name: string }>("TypePlugin");
const logger = new TypeConsoleLogger();
const valueProvider: ValueProvider<TypeLogger> = provide(LoggerToken, { useValue: logger });
const classProvider: ClassProvider<TypeLogger> = provide(LoggerToken, {
  useClass: TypeConsoleLogger,
});
const existingProvider: ExistingProvider<TypeLogger> = provide(LoggerToken, {
  useExisting: AliasToken,
});
const deps = [LoggerToken, { token: PluginToken, many: true }] as const;
const factoryProvider: FactoryProvider<string, typeof deps> = provide(SummaryToken, {
  deps,
  useFactory(resolvedLogger, plugins) {
    resolvedLogger.info(plugins.map((plugin) => plugin.name).join(","));
    return "ready";
  },
});
const container = createContainer();

container.provide(valueProvider);
container.override(classProvider);
container.override(existingProvider);
container.override(valueProvider);
container.provide(provide(PluginToken, { multi: true, useValue: { name: "a" } }));
container.provide(provide(PluginToken, { multi: true, useValue: { name: "b" } }));
container.provide(factoryProvider);

const resolvedLogger: TypeLogger = container.get(LoggerToken);
const optionalMissing: TypeLogger | undefined = container.get(token<TypeLogger>("Missing"), {
  optional: true,
});
const plugins: Array<{ readonly name: string }> = container.getAll(PluginToken);
const summary: string = container.get(SummaryToken);
const injectedSummary: string = container.build(
  class TypeSummaryConsumer {
    constructor(readonly value: string) {}
  },
  {
    deps: [SummaryToken],
  },
).value;

void [inject, injectedSummary, optionalMissing, plugins, resolvedLogger, summary];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  AmbiguousProviderError,
  AsyncProviderInSyncResolutionError,
  CircularDependencyError,
  DuplicateProviderError,
  FrozenContainerError,
  InjectContextError,
  LifetimeLeakError,
  MissingProviderError,
  createContainer,
  inject,
  provide,
  token,
} from "@cosystem/core";

class Logger {
  constructor() {
    this.messages = [];
  }

  info(message) {
    this.messages.push(message);
  }
}

class Counter {
  static inject = [Logger];

  constructor(logger) {
    this.count = 0;
    this.logger = logger;
  }

  increase() {
    this.count += 1;
    this.logger.info("count:" + String(this.count));
  }
}

await verifyResolution();
await verifyErrorsAndDisposal();

async function verifyResolution() {
  const LoggerToken = token("Logger");
  const AliasToken = token("AliasLogger");
  const OptionalToken = token("Optional");
  const PluginToken = token("Plugin");
  const SummaryToken = token("Summary");
  const InjectedToken = token("Injected");
  const AsyncToken = token("Async");
  const AsyncBuildToken = token("AsyncBuild");
  const root = createContainer();

  root.provide(Logger);
  root.provide(Counter);
  root.provide(provide(LoggerToken, { useClass: Logger }));
  root.provide(provide(AliasToken, { useExisting: LoggerToken }));
  root.provide(provide(PluginToken, { multi: true, useValue: { name: "root" } }));
  root.provide(provide(PluginToken, { multi: true, useValue: { name: "shared" } }));
  root.provide(
    provide(SummaryToken, {
      deps: [
        AliasToken,
        { token: OptionalToken, optional: true },
        { token: PluginToken, many: true },
      ],
      useFactory(logger, optional, plugins) {
        logger.info("factory");
        return (optional ?? "none") + ":" + plugins.map((plugin) => plugin.name).join(",");
      },
    }),
  );
  root.provide(
    provide(InjectedToken, {
      useFactory() {
        inject(LoggerToken).info("injected");
        return "injected-ready";
      },
    }),
  );
  root.provide(
    provide(AsyncToken, {
      useFactory: async () => "async-ready",
    }),
  );
  root.provide(
    provide(AsyncBuildToken, {
      useFactory: async () => "async-build-ready",
    }),
  );

  const counter = root.get(Counter);

  counter.increase();
  expectSame(root.get(Counter), counter, "class shorthand providers are singleton");
  expectJsonEqual(counter.logger.messages, ["count:1"], "static inject dependencies");
  expectEqual(root.get(SummaryToken), "none:root,shared", "factory optional and many deps");
  expectJsonEqual(
    root.getAll(PluginToken).map((plugin) => plugin.name),
    ["root", "shared"],
    "root multi provider order",
  );
  expectEqual(root.get(InjectedToken), "injected-ready", "inject context in factories");
  expectThrowsInstance(() => inject(LoggerToken), InjectContextError, "inject outside context");
  expectThrowsInstance(
    () => root.get(AsyncToken),
    AsyncProviderInSyncResolutionError,
    "sync get rejects async factory",
  );
  expectEqual(await root.getAsync(AsyncToken), "async-ready", "async factory via getAsync");

  const child = root.createScope();
  child.provide(provide(PluginToken, { multi: true, useValue: { name: "child" } }));
  expectJsonEqual(
    child.getAll(PluginToken).map((plugin) => plugin.name),
    ["root", "shared", "child"],
    "child scope inherits parent multi providers",
  );
  expectSame(child.get(LoggerToken), root.get(LoggerToken), "child scope resolves parent singleton");

  class BuiltCounter {
    constructor(logger) {
      this.logger = logger;
    }
  }

  const built = root.build(BuiltCounter, { deps: [LoggerToken] });
  expectSame(built.logger, root.get(LoggerToken), "build resolves explicit deps");

  class AsyncBuilt {
    constructor(value) {
      this.value = value;
    }
  }

  expectThrowsInstance(
    () => root.build(AsyncBuilt, { deps: [AsyncBuildToken] }),
    AsyncProviderInSyncResolutionError,
    "sync build rejects async deps",
  );
  expectEqual(
    (await root.buildAsync(AsyncBuilt, { deps: [AsyncBuildToken] })).value,
    "async-build-ready",
    "buildAsync resolves async deps",
  );

  await child.dispose();
  await root.dispose();
}

async function verifyErrorsAndDisposal() {
  const LoggerToken = token("ErrorLogger");
  const MultiToken = token("ErrorMulti");
  const MissingToken = token("Missing");
  const disposed = [];
  const root = createContainer();

  root.provide(provide(LoggerToken, { useValue: new Logger() }));
  expectThrowsInstance(
    () => root.provide(provide(LoggerToken, { useValue: new Logger() })),
    DuplicateProviderError,
    "duplicate provider",
  );

  root.provide(provide(MultiToken, { multi: true, useValue: "a" }));
  root.provide(provide(MultiToken, { multi: true, useValue: "b" }));
  expectThrowsInstance(() => root.get(MultiToken), AmbiguousProviderError, "ambiguous multi get");
  expectJsonEqual(root.getAll(MultiToken), ["a", "b"], "multi getAll still works");
  expectThrowsInstance(() => root.get(MissingToken), MissingProviderError, "missing provider");

  root.freeze();
  expectThrowsInstance(() => root.provide(Logger), FrozenContainerError, "provide after freeze");
  expectThrowsInstance(
    () => root.override(provide(LoggerToken, { useValue: new Logger() })),
    FrozenContainerError,
    "override after freeze",
  );

  class FirstCircular {
    static inject = [];
  }

  class SecondCircular {
    static inject = [FirstCircular];
  }

  FirstCircular.inject = [SecondCircular];
  const circular = createContainer();
  circular.provide(FirstCircular);
  circular.provide(SecondCircular);
  expectThrowsInstance(() => circular.get(FirstCircular), CircularDependencyError, "circular deps");

  class RequestContext {
    constructor() {
      this.id = Symbol("request");
    }
  }

  class ApiClient {
    static inject = [RequestContext];

    constructor(context) {
      this.context = context;
    }
  }

  const leaking = createContainer();
  leaking.provide(provide(RequestContext, { scope: "scoped", useClass: RequestContext }));
  leaking.provide(ApiClient);
  expectThrowsInstance(() => leaking.get(ApiClient), LifetimeLeakError, "lifetime leak");

  const allowed = createContainer();
  allowed.provide(
    provide(RequestContext, {
      leakSafe: true,
      scope: "scoped",
      useClass: RequestContext,
    }),
  );
  allowed.provide(ApiClient);
  expectSame(allowed.get(ApiClient).context, allowed.get(RequestContext), "leakSafe dependency");

  class FirstDisposable {
    dispose() {
      disposed.push("first");
    }
  }

  class SecondDisposable {
    dispose() {
      disposed.push("second");
      throw new Error("dispose failed");
    }
  }

  const disposable = createContainer();
  disposable.provide(FirstDisposable);
  disposable.provide(SecondDisposable);
  disposable.get(FirstDisposable);
  disposable.get(SecondDisposable);

  await expectRejects(
    disposable.dispose(),
    AggregateError,
    "One or more providers failed to dispose.",
    "aggregate disposal error",
  );
  expectJsonEqual(disposed, ["second", "first"], "reverse disposal order");

  await root.dispose();
  await circular.dispose();
  await leaking.dispose();
  await allowed.dispose();
}

async function expectRejects(promise, ExpectedError, message, label) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExpectedError && error.message.includes(message)) {
      return error;
    }

    throw new Error(label + ": expected " + ExpectedError.name + ", got " + formatError(error));
  }

  throw new Error(label + ": expected rejection");
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

function expectJsonEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(label + ": expected " + expectedJson + ", got " + actualJson);
  }
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

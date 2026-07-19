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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-testing-helper-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const testingTarball = await packPackage("@cosystem/testing");

  await writeConsumerProject(coreTarball, testingTarball, catalog);
  await run(
    "pnpm",
    ["install", "--prefer-offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed testing helper runtime.");
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

async function writeConsumerProject(coreTarball, testingTarball, catalog) {
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-testing-helper-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/testing": `file:${testingTarball}`,
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
      `  "@cosystem/testing": ${JSON.stringify(`file:${testingTarball}`)}`,
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
  return `import { defineModule, provide, type App, type TestApp } from "@cosystem/core";
import { testApp, type AutoStartedTestAppOptions } from "@cosystem/testing";

abstract class TypeLogger {
  abstract info(message: string): void;
}

class TypeCounter {
  count = 0;

  constructor(readonly logger: TypeLogger) {}

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): number {
    this.count += step;
    this.logger.info(String(this.count));
    return this.count;
  }

  async record(): Promise<void> {
    await Promise.resolve();
    this.logger.info("effect:" + String(this.count));
  }
}

defineModule(TypeCounter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [TypeLogger],
  effects: ["record"],
  name: "typeCounter",
  state: ["count"],
});

const logger: TypeLogger = {
  info(_message: string): void {},
};
const baseLogger: TypeLogger = {
  info(_message: string): void {},
};
const manual: TestApp = testApp({
  engine: {
    patches: true,
  },
  overrides: [provide(TypeLogger, { useValue: logger })],
  providers: [TypeCounter, provide(TypeLogger, { useValue: baseLogger })],
  strictActions: true,
});
const autoOptions: AutoStartedTestAppOptions = {
  autoStart: true,
  providers: [TypeCounter, provide(TypeLogger, { useValue: logger })],
};
const automatic: Promise<TestApp> = testApp(autoOptions);
const started = await automatic;
const app: App = started;

await started.test.flushEffects();
void [
  app,
  manual.test.getActions(),
  manual.test.getPatches(),
  manual.test.getState(),
  started.getModule(TypeCounter).double,
];
await manual.dispose();
await started.dispose();
`;
}

function createRuntimeConsumerSource() {
  return `import { CosystemError, defineModule, provide } from "@cosystem/core";
import { testApp } from "@cosystem/testing";

class Logger {
  info(_message) {}
}

class RecordingLogger extends Logger {
  constructor() {
    super();
    this.messages = [];
  }

  info(message) {
    this.messages.push(message);
  }
}

class TestingCounter {
  constructor(logger) {
    this.logger = logger;
    this.count = 0;
  }

  get double() {
    return this.count * 2;
  }

  increase(step = 1) {
    this.count += step;
    this.logger.info("count:" + String(this.count));
    return this.count;
  }

  async record() {
    const count = this.count;
    await Promise.resolve();
    this.logger.info("effect:" + String(count));
  }
}

defineModule(TestingCounter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [Logger],
  effects: ["record"],
  name: "testingCounter",
  state: ["count"],
});

class AutoStarted {
  onStart() {
    autoStartEvents.push("start");
  }
}

defineModule(AutoStarted, {
  name: "autoStarted",
});

const autoStartEvents = [];

await verifyInspectorAndOverrides();
await verifyAutoStart();

async function verifyInspectorAndOverrides() {
  const baseLogger = new RecordingLogger();
  const overrideLogger = new RecordingLogger();
  const app = testApp({
    engine: {
      patches: true,
    },
    overrides: [provide(Logger, { useValue: overrideLogger })],
    providers: [TestingCounter, provide(Logger, { useValue: baseLogger })],
    strictActions: true,
  });
  const counter = app.getModule(TestingCounter);

  expectThrows(
    () => {
      counter.count = 10;
    },
    CosystemError,
    "strict action mutation",
  );

  await app.test.flushEffects();
  expectJsonEqual(baseLogger.messages, [], "override replaces base provider");
  expectJsonEqual(overrideLogger.messages, ["effect:0"], "initial effect flush");
  expectJsonEqual(app.store.getPureState(), { testingCounter: { count: 0 } }, "initial app state");

  counter.increase(2);
  await app.test.flushEffects();

  expectEqual(counter.double, 4, "computed selector");
  expectJsonEqual(
    overrideLogger.messages,
    ["effect:0", "count:2", "effect:2"],
    "action and async effect log",
  );
  expectJsonEqual(app.test.getState(), { testingCounter: { count: 2 } }, "updated inspector state");
  expectEqual(app.test.getActions().length, 1, "records one action");
  expectEqual(app.test.getActions()[0].module, "testingCounter", "action module");
  expectEqual(app.test.getActions()[0].method, "increase", "action method");
  expectJsonEqual(app.test.getActions()[0].args, [2], "action args");
  expectEqual(typeof app.test.getActions()[0].endedAt, "number", "action endedAt");
  expectEqual(app.test.getPatches().length > 0, true, "patch inspector records patches");

  app.test.clearActions();
  app.test.clearPatches();
  expectJsonEqual(app.test.getActions(), [], "clear actions");
  expectJsonEqual(app.test.getPatches(), [], "clear patches");

  await app.dispose();
}

async function verifyAutoStart() {
  const app = await testApp({
    autoStart: true,
    providers: [AutoStarted],
  });

  expectEqual(app.started, true, "autoStart started flag");
  expectJsonEqual(autoStartEvents, ["start"], "autoStart lifecycle");

  await app.dispose();
}

function expectThrows(callback, errorClass, label) {
  try {
    callback();
  } catch (error) {
    if (error instanceof errorClass) {
      return;
    }

    throw new Error(label + ": expected " + errorClass.name + ", got " + formatError(error));
  }

  throw new Error(label + ": expected throw");
}

function expectEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
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

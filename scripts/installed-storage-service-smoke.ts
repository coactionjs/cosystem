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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-storage-service-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const storageTarball = await packPackage("@cosystem/storage");

  await writeConsumerProject({ catalog, coreTarball, storageTarball });
  await run(
    "pnpm",
    ["install", "--prefer-offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed storage service runtime.");
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

async function writeConsumerProject({ catalog, coreTarball, storageTarball }) {
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-storage-service-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/storage": `file:${storageTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          localspace: readCatalogVersion(catalog, "localspace"),
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
      `  "@cosystem/storage": ${JSON.stringify(`file:${storageTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "localspace": ${JSON.stringify(readCatalogVersion(catalog, "localspace"))}`,
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
  return `import { createApp } from "@cosystem/core";
import {
  StorageToken,
  createLocalSpaceStorage,
  createLocalSpaceStoragePlugin,
  type LocalSpacePlugin,
  type StorageService,
  type StorageTransactionScope,
} from "@cosystem/storage";

const storage: StorageService = createLocalSpaceStorage({
  options: {
    driver: "memoryStorageWrapper",
    name: "cosystem-storage-service-type",
    storeName: "state",
  },
});
const localspacePlugin: LocalSpacePlugin = {
  name: "type-plugin",
  beforeSet(_key: string, value: unknown): unknown {
    return value;
  },
};
const plugin = createLocalSpaceStoragePlugin({
  hydrate: false,
  options: {
    driver: "memoryStorageWrapper",
    name: "cosystem-storage-service-plugin-type",
    plugins: [localspacePlugin],
    storeName: "state",
  },
  persist: false,
});
const app = createApp({
  plugins: [plugin],
});
const transactionResult: number = await storage.transaction(
  "readwrite",
  async (scope: StorageTransactionScope) => {
    await scope.set("value", 1);
    return (await scope.get<number>("value")) ?? 0;
  },
);

void [app.get(StorageToken), transactionResult, storage.getPerformanceStats()];
`;
}

function createRuntimeConsumerSource() {
  return `import { createApp } from "@cosystem/core";
import {
  StorageToken,
  createLocalSpaceStorage,
  createLocalSpaceStoragePlugin,
} from "@cosystem/storage";

const storageName = "cosystem-storage-service-smoke";
const storage = createLocalSpaceStorage({
  options: {
    driver: "memoryStorageWrapper",
    name: storageName,
    storeName: "state",
  },
});

await storage.ready();
expectEqual(storage.driver(), "memoryStorageWrapper", "memory storage driver");
expectEqual(await storage.length(), 0, "initial storage length");
expectEqual(storage.getPerformanceStats(), undefined, "memory driver performance stats");

await storage.set("one", { count: 1 });
expectJsonEqual(await storage.get("one"), { count: 1 }, "single set/get");

expectJsonEqual(
  await storage.setMany([
    { key: "two", value: { count: 2 } },
    { key: "three", value: { count: 3 } },
  ]),
  [
    { key: "two", value: { count: 2 } },
    { key: "three", value: { count: 3 } },
  ],
  "setMany result",
);
expectJsonEqual(
  await storage.getMany(["one", "two", "missing"]),
  [
    { key: "one", value: { count: 1 } },
    { key: "two", value: { count: 2 } },
    { key: "missing", value: null },
  ],
  "getMany result",
);
expectJsonEqual(
  (await storage.keys()).toSorted(),
  ["one", "three", "two"],
  "keys after batch set",
);

const transactionKeys = await storage.transaction("readwrite", async (scope) => {
  const two = await scope.get("two");

  await scope.set("four", { count: two.count + 2 });
  await scope.remove("three");

  return scope.keys();
});

expectJsonEqual(transactionKeys.toSorted(), ["four", "one", "two"], "transaction keys");
expectJsonEqual(await storage.get("four"), { count: 4 }, "transaction set result");
expectEqual(await storage.get("three"), null, "transaction remove result");
await expectRejects(
  storage.transaction("readonly", async (scope) => {
    await scope.set("bad", { count: 0 });
  }),
  "Transaction is readonly",
  "readonly transaction rejects writes",
);
expectEqual(await storage.get("bad"), null, "readonly transaction did not write");

await storage.removeMany(["one", "two"]);
expectJsonEqual(
  await storage.getMany(["one", "two", "four"]),
  [
    { key: "one", value: null },
    { key: "two", value: null },
    { key: "four", value: { count: 4 } },
  ],
  "removeMany result",
);

await storage.clear();
expectEqual(await storage.length(), 0, "storage clear result");

const pluginEvents = [];
const pluginStorage = createLocalSpaceStorage({
  options: {
    driver: "memoryStorageWrapper",
    name: storageName + "-plugins",
    plugins: [
      {
        name: "tagger",
        afterGet(key, value) {
          pluginEvents.push("get:" + key);
          return value;
        },
        beforeSet(key, value) {
          pluginEvents.push("set:" + key);
          return {
            ...value,
            tagged: true,
          };
        },
        onDestroy() {
          pluginEvents.push("destroy");
        },
      },
    ],
    storeName: "state",
  },
});

await pluginStorage.set("item", { value: 1 });
const pluginValue = await pluginStorage.get("item");
expectEqual(pluginValue.value, 1, "localspace plugin original value");
expectEqual(pluginValue.tagged, true, "localspace plugin tagged value");
await pluginStorage.destroy();
expectJsonEqual(pluginEvents, ["set:item", "get:item", "destroy"], "localspace plugin hooks");

const appStorage = createLocalSpaceStorage({
  options: {
    driver: "memoryStorageWrapper",
    name: storageName + "-di",
    storeName: "state",
  },
});
const storagePlugin = createLocalSpaceStoragePlugin({
  hydrate: false,
  persist: false,
  service: appStorage,
});
const app = createApp({
  plugins: [storagePlugin],
});

await app.start();
expectSame(app.get(StorageToken), appStorage, "storage service is provided through DI");
await app.get(StorageToken).set("di", { value: 5 });
expectJsonEqual(await storagePlugin.storage.get("di"), { value: 5 }, "storage token service writes");
await app.dispose();
await appStorage.destroy();
await storage.dropInstance({ name: storageName, storeName: "state" });
await storage.destroy();

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

async function expectRejects(promise, message, label) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) {
      return;
    }

    throw new Error(label + ": expected " + message + ", got " + formatError(error));
  }

  throw new Error(label + ": expected rejection");
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

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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-data-transport-worker-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject(coreTarball, catalog);
  await run(
    "pnpm",
    ["install", "--offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed data-transport worker runtime.");
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
        name: "cosystem-data-transport-worker-smoke",
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
  createDataTransportWorkerTransport,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type DataTransportEmitOptions,
  type DataTransportLike,
  type WorkerMessage,
} from "@cosystem/core";

class TypeCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

defineModule(TypeCounter, {
  actions: ["increase"],
  name: "typeCounter",
  state: ["count"],
});

const transport: DataTransportLike = {
  emit(_options: DataTransportEmitOptions, _message: WorkerMessage) {
    return Promise.resolve();
  },
  listen(_name, _listener) {
    return () => undefined;
  },
};
const client = createWorkerClient({
  transport: createDataTransportWorkerTransport(transport),
});
const host = createWorkerApp({
  providers: [TypeCounter],
  transport: createDataTransportWorkerTransport(transport),
});

void [client, host];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  createDataTransportWorkerTransport,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";

class Counter {
  count = 0;

  increase(step = 1) {
    this.count += step;
    return this.count;
  }

  reset() {
    this.count = 0;
    return this.count;
  }
}

defineModule(Counter, {
  actions: ["increase", "reset"],
  name: "counter",
  state: ["count"],
});

class MemoryDataTransportEndpoint {
  listeners = new Map();
  peer = undefined;

  connect(peer) {
    this.peer = peer;
  }

  async emit(options, message) {
    const name = typeof options === "string" ? options : options.name;
    const listeners = [...(this.peer?.listeners.get(name) ?? [])];

    await Promise.resolve();

    for (const listener of listeners) {
      listener(message);
    }
  }

  listen(name, listener) {
    let listeners = this.listeners.get(name);

    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(name, listeners);
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        this.listeners.delete(name);
      }
    };
  }

  listenerCount() {
    let count = 0;

    for (const listeners of this.listeners.values()) {
      count += listeners.size;
    }

    return count;
  }
}

const [hostEndpoint, clientEndpoint] = createDataTransportPair();
const client = createWorkerClient({
  transport: createDataTransportWorkerTransport(clientEndpoint),
});
const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createDataTransportWorkerTransport(hostEndpoint),
});
const stateVersions = [];
const watchValues = [];
const counter = client.module("counter");

client.subscribe((message) => {
  stateVersions.push(message.version);
});

await client.ready;

const unsubscribeWatch = client.watch(
  (state) => state.counter.count,
  (value) => {
    watchValues.push(value);
  },
  {
    immediate: true,
  },
);

expectEqual(client.select((state) => state.counter.count), 0, "initial client count");
expectEqual(await counter.increase(4), 4, "remote increase result");
expectEqual(client.select((state) => state.counter.count), 4, "client count after increase");
expectEqual(await counter.increase(3), 7, "second remote increase result");
expectEqual(client.select((state) => state.counter.count), 7, "client count after second increase");
expectEqual(await counter.reset(), 0, "remote reset result");
expectEqual(client.select((state) => state.counter.count), 0, "client count after reset");
expectArray(watchValues, [0, 4, 7, 0], "watch values");

if (stateVersions.length < 4) {
  throw new Error(\`Expected at least 4 state versions, got \${JSON.stringify(stateVersions)}.\`);
}

unsubscribeWatch();
client.dispose();
await host.dispose();

expectEqual(hostEndpoint.listenerCount(), 0, "host listener count after dispose");
expectEqual(clientEndpoint.listenerCount(), 0, "client listener count after dispose");

function createDataTransportPair() {
  const left = new MemoryDataTransportEndpoint();
  const right = new MemoryDataTransportEndpoint();

  left.connect(right);
  right.connect(left);

  return [left, right];
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(\`\${label} expected \${expected}, got \${actual}.\`);
  }
}

function expectArray(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      \`\${label} mismatch. Actual: \${JSON.stringify(actual)} Expected: \${JSON.stringify(
        expected,
      )}\`,
    );
  }
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
    return await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    if (typeof error.stdout === "string" && error.stdout.length > 0) {
      process.stdout.write(error.stdout);
    }

    if (typeof error.stderr === "string" && error.stderr.length > 0) {
      process.stderr.write(error.stderr);
    }

    throw error;
  }
}

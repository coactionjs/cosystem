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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-worker-state-conflict-"));
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

  console.log("Verified installed worker state sections and conflict handling.");
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
        name: "cosystem-worker-state-conflict-smoke",
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
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type WorkerClient,
  type WorkerConflictEvent,
  type WorkerStateMessage,
  type WorkerTransport,
} from "@cosystem/core";

class TypeVisibleCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

class TypeHiddenState {
  value = "initial";

  set(value: string): string {
    this.value = value;
    return this.value;
  }
}

defineModule(TypeVisibleCounter, {
  actions: ["increase"],
  name: "typeVisibleCounter",
  state: ["count"],
});
defineModule(TypeHiddenState, {
  actions: ["set"],
  name: "typeHiddenState",
  state: ["value"],
});

const [hostTransport, clientTransport]: readonly [WorkerTransport, WorkerTransport] =
  createMemoryWorkerTransportPair();
const conflicts: WorkerConflictEvent[] = [];
const messages: WorkerStateMessage[] = [];
const client: WorkerClient = createWorkerClient({
  onConflict: (event) => {
    conflicts.push(event);
  },
  transport: clientTransport,
});
const host = createWorkerApp({
  providers: [TypeVisibleCounter, TypeHiddenState],
  stateSections: ["typeVisibleCounter"],
  sync: "patch",
  transport: hostTransport,
});

client.subscribe((message) => {
  messages.push(message);
});

await client.ready;
await client.module<TypeVisibleCounter>("typeVisibleCounter").increase(1);

void [conflicts, messages, host.app, client.getState()];
client.dispose();
await host.dispose();
`;
}

function createRuntimeConsumerSource() {
  return `import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";

class VisibleCounter {
  constructor() {
    this.count = 0;
  }

  increase(step = 1) {
    this.count += step;
    return this.count;
  }
}

class HiddenState {
  constructor() {
    this.value = "initial";
  }

  set(value) {
    this.value = value;
    return this.value;
  }
}

defineModule(VisibleCounter, {
  actions: ["increase"],
  name: "visibleCounter",
  state: ["count"],
});
defineModule(HiddenState, {
  actions: ["set"],
  name: "hiddenState",
  state: ["value"],
});

await verifyStateSections();
await verifyConflicts();
await verifyWatchEqualityAndDispose();

async function verifyStateSections() {
  const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
  const client = createWorkerClient({
    transport: clientTransport,
  });
  const host = createWorkerApp({
    providers: [VisibleCounter, HiddenState],
    stateSections: ["visibleCounter"],
    sync: "patch",
    transport: hostTransport,
  });
  const messages = [];

  client.subscribe((message) => {
    messages.push(message);
  });

  await client.ready;

  expectJsonEqual(client.getState(), { visibleCounter: { count: 0 } }, "sectioned initial state");
  expectJsonEqual(messages.map((message) => message.sections), [["visibleCounter"]], "initial sections");

  await client.module("hiddenState").set("secret");

  expectJsonEqual(client.getState(), { visibleCounter: { count: 0 } }, "hidden section stays hidden");
  expectEqual(messages.length, 1, "hidden state does not publish state message");

  await client.module("visibleCounter").increase(3);

  expectJsonEqual(client.getState(), { visibleCounter: { count: 3 } }, "visible section updates");
  expectEqual(messages.length, 2, "visible state publishes patch");
  expectEqual(messages[1].sync, "patch", "visible update uses patch sync");
  expectJsonEqual(messages[1].sections, ["visibleCounter"], "visible update sections");

  client.dispose();
  await host.dispose();
}

async function verifyConflicts() {
  const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
  const conflicts = [];
  const client = createWorkerClient({
    onConflict(event) {
      conflicts.push(event);
    },
    transport: clientTransport,
  });

  hostTransport.post({
    patches: [
      {
        op: "replace",
        path: "/visibleCounter/count",
        value: 9,
      },
    ],
    sync: "patch",
    type: "state",
    version: 1,
  });
  hostTransport.post({
    state: {
      visibleCounter: {
        count: 1,
      },
    },
    sync: "snapshot",
    type: "state",
    version: 1,
  });

  await client.ready;

  hostTransport.post({
    state: {
      visibleCounter: {
        count: 0,
      },
    },
    sync: "snapshot",
    type: "state",
    version: 1,
  });
  hostTransport.post({
    patches: [
      {
        op: "replace",
        path: 1,
        value: 9,
      },
    ],
    sync: "patch",
    type: "state",
    version: 2,
  });
  hostTransport.post({
    patches: [
      {
        op: "replace",
        path: "/visibleCounter/count",
        value: 9,
      },
    ],
    sync: "patch",
    type: "state",
    version: 3,
  });

  expectJsonEqual(
    conflicts.map((event) => event.reason),
    ["missing-snapshot", "stale-message", "patch-apply-failed", "version-gap"],
    "worker conflict reasons",
  );
  expectJsonEqual(
    conflicts.map((event) => [event.currentVersion, event.incomingVersion]),
    [
      [0, 1],
      [1, 1],
      [1, 2],
      [1, 3],
    ],
    "worker conflict versions",
  );
  expectJsonEqual(client.getState(), { visibleCounter: { count: 1 } }, "conflicts keep current snapshot");

  client.dispose();
}

async function verifyWatchEqualityAndDispose() {
  const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
  const client = createWorkerClient({
    transport: clientTransport,
  });
  const values = [];
  const host = createWorkerApp({
    providers: [VisibleCounter],
    transport: hostTransport,
  });

  await client.ready;

  const unsubscribe = client.watch(
    (state) => ({
      parity: state.visibleCounter.count % 2,
    }),
    (value) => {
      values.push(value);
    },
    {
      equals: (value, previous) => value.parity === previous.parity,
    },
  );

  await client.module("visibleCounter").increase(2);
  await client.module("visibleCounter").increase(1);

  expectJsonEqual(values, [{ parity: 1 }], "worker watch equality");

  unsubscribe();
  await client.module("visibleCounter").increase(1);
  expectJsonEqual(values, [{ parity: 1 }], "worker watch unsubscribe");

  client.dispose();
  await host.dispose();

  const [, disposedClientTransport] = createMemoryWorkerTransportPair();
  const disposedClient = createWorkerClient({
    transport: disposedClientTransport,
  });
  const pending = disposedClient.call("visibleCounter", "increase", 1);

  disposedClient.dispose();
  await expectRejects(pending, "Worker client disposed before response.", "disposed pending call");
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

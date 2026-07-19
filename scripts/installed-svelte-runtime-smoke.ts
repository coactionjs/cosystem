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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-svelte-runtime-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const svelteTarball = await packPackage("@cosystem/svelte");

  await writeConsumerProject({ catalog, coreTarball, svelteTarball });
  await run(
    "pnpm",
    ["install", "--prefer-offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed Svelte stores and runes runtime.");
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

async function writeConsumerProject({ catalog, coreTarball, svelteTarball }) {
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-svelte-runtime-smoke",
        private: true,
        type: "module",
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/svelte": `file:${svelteTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          svelte: readCatalogVersion(catalog, "svelte"),
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
      `  "@cosystem/svelte": ${JSON.stringify(`file:${svelteTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "svelte": ${JSON.stringify(readCatalogVersion(catalog, "svelte"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["DOM", "DOM.Iterable", "ES2023"],
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
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
} from "@cosystem/core";
import {
  clearCoSystemApp,
  clearWorkerClient,
  moduleStore,
  selectedModuleStore,
  selectorStore,
  setCoSystemApp,
  setWorkerClient,
  workerModuleStore,
  workerSelectorStore,
} from "@cosystem/svelte";
import {
  moduleRune,
  selectedModuleRune,
  selectorRune,
  workerModuleRune,
  workerSelectorRune,
} from "@cosystem/svelte/runes";
import type { Readable } from "svelte/store";

class TypeSvelteCounter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }
}

defineModule(TypeSvelteCounter, {
  actions: ["increase"],
  computed: ["double"],
  name: "typeSvelteCounter",
  state: ["count"],
});

const app = createApp({
  providers: [TypeSvelteCounter],
});
const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
const client = createWorkerClient({ transport: clientTransport });
const host = createWorkerApp({
  providers: [TypeSvelteCounter],
  transport: hostTransport,
});

setCoSystemApp(app);
setWorkerClient(client);

const counterStore: Readable<TypeSvelteCounter> = moduleStore(TypeSvelteCounter);
const doubleStore: Readable<number> = selectedModuleStore(
  TypeSvelteCounter,
  (module) => module.double,
);
const countStore: Readable<number> = selectorStore(
  (currentApp) => currentApp.getModule(TypeSvelteCounter).count,
);
const workerCounterStore: Readable<AsyncMethodProxy<TypeSvelteCounter>> =
  workerModuleStore<TypeSvelteCounter>("typeSvelteCounter");
const workerCountStore: Readable<number> = workerSelectorStore(
  (state) => (state as { readonly typeSvelteCounter: { readonly count: number } })
    .typeSvelteCounter.count,
);

void [
  counterStore,
  doubleStore,
  countStore,
  workerCounterStore,
  workerCountStore,
  moduleRune(TypeSvelteCounter),
  selectedModuleRune(TypeSvelteCounter, (module) => module.double),
  selectorRune((currentApp) => currentApp.getModule(TypeSvelteCounter).count),
  workerModuleRune<TypeSvelteCounter>("typeSvelteCounter"),
  workerSelectorRune(
    (state) => (state as { readonly typeSvelteCounter: { readonly count: number } })
      .typeSvelteCounter.count,
  ),
];

clearCoSystemApp();
clearWorkerClient();
client.dispose();
void host.dispose();
void app.dispose();
`;
}

function createRuntimeConsumerSource() {
  return `import {
  createApp,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";
import {
  clearCoSystemApp,
  clearWorkerClient,
  moduleStore,
  selectedModuleStore,
  selectorStore,
  setCoSystemApp,
  setWorkerClient,
  workerModuleStore,
  workerSelectorStore,
} from "@cosystem/svelte";
import {
  moduleRune,
  selectedModuleRune,
  selectorRune,
  workerModuleRune,
  workerSelectorRune,
} from "@cosystem/svelte/runes";
import { get } from "svelte/store";

class SvelteCounter {
  constructor() {
    this.count = 0;
  }

  get double() {
    return this.count * 2;
  }

  increase(step = 1) {
    this.count += step;
  }
}

defineModule(SvelteCounter, {
  actions: ["increase"],
  computed: ["double"],
  name: "svelteRuntimeCounter",
  state: ["count"],
});

const app = createApp({
  providers: [SvelteCounter],
});
const counter = app.getModule(SvelteCounter);

setCoSystemApp(app);

const moduleValues = [];
const counterStore = moduleStore(SvelteCounter);
const selectedValues = [];
const doubleStore = selectedModuleStore(SvelteCounter, (module) => module.double);
const parityValues = [];
const parityStore = selectorStore(
  (currentApp) => ({
    value: currentApp.getModule(SvelteCounter).count % 2,
  }),
  {
    equals: (value, previous) => value.value === previous.value,
  },
);
const unsubscribeCounter = counterStore.subscribe((value) => {
  moduleValues.push(value);
});
const unsubscribeDouble = doubleStore.subscribe((value) => {
  selectedValues.push(value);
});
const unsubscribeParity = parityStore.subscribe((value) => {
  parityValues.push(value);
});

expectSame(get(counterStore), counter, "moduleStore exposes the app module");
counter.increase(2);
expectEqual(get(doubleStore), 4, "selectedModuleStore updates computed values");
counter.increase(1);
expectEqual(get(parityStore).value, 1, "selectorStore updates selected values");
expectArrayEqual(selectedValues, [0, 4, 6], "selectedModuleStore publish sequence");
expectArrayEqual(
  parityValues.map((value) => value.value),
  [0, 1],
  "selectorStore equality publish sequence",
);
expectEqual(moduleValues.length, 1, "moduleStore keeps stable module identity");

const counterRune = moduleRune(SvelteCounter);
const doubleRune = selectedModuleRune(SvelteCounter, (module) => module.double);
const parityRune = selectorRune(
  (currentApp) => ({
    value: currentApp.getModule(SvelteCounter).count % 2,
  }),
  {
    equals: (value, previous) => value.value === previous.value,
  },
);
const firstParityRuneValue = parityRune.current;

expectSame(counterRune.current, counter, "moduleRune exposes the app module");
expectEqual(doubleRune.current, 6, "selectedModuleRune reads computed values");
counter.increase(2);
expectEqual(doubleRune.current, 10, "selectedModuleRune refreshes after state changes");
expectSame(parityRune.current, firstParityRuneValue, "selectorRune honors equality");
counter.increase(1);
expectEqual(parityRune.current.value, 0, "selectorRune refreshes when equality changes");

unsubscribeCounter();
unsubscribeDouble();
unsubscribeParity();
clearCoSystemApp();

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
const client = createWorkerClient({
  transport: clientTransport,
});
const host = createWorkerApp({
  providers: [SvelteCounter],
  sync: "patch",
  transport: hostTransport,
});

await client.ready;
setWorkerClient(client);

const workerCounterStore = workerModuleStore("svelteRuntimeCounter");
const workerCountStore = workerSelectorStore(
  (state) => state.svelteRuntimeCounter.count,
);
const workerValues = [];
const unsubscribeWorker = workerCountStore.subscribe((value) => {
  workerValues.push(value);
});
const workerCounter = get(workerCounterStore);

await workerCounter.increase(3);
expectEqual(get(workerCountStore), 3, "workerSelectorStore updates from worker state");
expectArrayEqual(workerValues, [0, 3], "workerSelectorStore publish sequence");

const workerCounterRune = workerModuleRune("svelteRuntimeCounter");
const workerCountRune = workerSelectorRune(
  (state) => state.svelteRuntimeCounter.count,
);

expectSame(workerCounterRune.current, workerCounterRune.value, "workerModuleRune keeps proxy identity");
expectEqual(workerCountRune.current, 3, "workerSelectorRune reads current worker state");
await workerCounterRune.current.increase(4);
expectEqual(workerCountRune.current, 7, "workerSelectorRune refreshes after worker updates");

unsubscribeWorker();
clearWorkerClient();
client.dispose();
await host.dispose();
await app.dispose();

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

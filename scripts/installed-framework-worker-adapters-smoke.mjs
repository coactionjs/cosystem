#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-framework-worker-adapters-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");
const packageNames = [
  "@cosystem/angular",
  "@cosystem/core",
  "@cosystem/react",
  "@cosystem/solid",
  "@cosystem/svelte",
  "@cosystem/vue",
];

try {
  const catalog = await readCatalog();
  const tarballByName = new Map();

  for (const packageName of packageNames) {
    tarballByName.set(packageName, await packPackage(packageName));
  }

  await writeConsumerProject({ catalog, tarballByName });
  await run("pnpm", ["install", "--offline", "--ignore-scripts"], consumerDir);
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed framework worker adapters runtime.");
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

async function writeConsumerProject({ catalog, tarballByName }) {
  const dependencies = {
    "@angular/core": readCatalogVersion(catalog, "@angular/core"),
    "@vue/server-renderer": readCatalogVersion(catalog, "@vue/server-renderer"),
    coaction: readCatalogVersion(catalog, "coaction"),
    react: readCatalogVersion(catalog, "react"),
    "react-test-renderer": readCatalogVersion(catalog, "react-test-renderer"),
    rxjs: readCatalogVersion(catalog, "rxjs"),
    "solid-js": readCatalogVersion(catalog, "solid-js"),
    svelte: readCatalogVersion(catalog, "svelte"),
    vue: readCatalogVersion(catalog, "vue"),
  };
  const devDependencies = {
    "@types/react": readCatalogVersion(catalog, "@types/react"),
    "@types/react-test-renderer": readCatalogVersion(catalog, "@types/react-test-renderer"),
    typescript: readCatalogVersion(catalog, "typescript"),
  };
  const overrides = {
    ...dependencies,
    ...devDependencies,
  };

  for (const packageName of packageNames) {
    const tarballSpec = `file:${tarballByName.get(packageName)}`;

    dependencies[packageName] = tarballSpec;
    overrides[packageName] = tarballSpec;
  }

  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-framework-worker-adapters-smoke",
        private: true,
        type: "module",
        dependencies: sortObject(dependencies),
        devDependencies: sortObject(devDependencies),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(consumerDir, "pnpm-lock.yaml"), await readFile(lockfilePath, "utf8"));
  await writeFile(join(consumerDir, "pnpm-workspace.yaml"), createWorkspaceSource(overrides));
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

function createWorkspaceSource(overrides) {
  const lines = ["overrides:"];

  for (const [name, value] of Object.entries(sortObject(overrides))) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  }

  return `${lines.join("\n")}\n`;
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function createTypeConsumerSource() {
  return `import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
  type WorkerClient,
} from "@cosystem/core";
import {
  injectWorkerModule as injectAngularWorkerModule,
  injectWorkerSignal as injectAngularWorkerSignal,
  provideWorkerClient as provideAngularWorkerClient,
} from "@cosystem/angular";
import {
  WorkerClientProvider as ReactWorkerClientProvider,
  useWorkerModule as useReactWorkerModule,
  useWorkerSelector as useReactWorkerSelector,
} from "@cosystem/react";
import {
  WorkerClientProvider as SolidWorkerClientProvider,
  useWorkerModule as useSolidWorkerModule,
  useWorkerSelector as useSolidWorkerSelector,
} from "@cosystem/solid";
import {
  setWorkerClient,
  workerModuleStore as svelteWorkerModuleStore,
  workerSelectorStore as svelteWorkerSelectorStore,
} from "@cosystem/svelte";
import {
  provideWorkerClient as provideVueWorkerClient,
  useWorkerModule as useVueWorkerModule,
  useWorkerSelector as useVueWorkerSelector,
} from "@cosystem/vue";
import type { Signal } from "@angular/core";
import type { Accessor } from "solid-js";
import type { Readable } from "svelte/store";
import type { Ref } from "vue";

class TypeWorkerCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

defineModule(TypeWorkerCounter, {
  actions: ["increase"],
  name: "typeWorkerCounter",
  state: ["count"],
});

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
const client: WorkerClient = createWorkerClient({
  transport: clientTransport,
});
const host = createWorkerApp({
  providers: [TypeWorkerCounter],
  transport: hostTransport,
});
const selectCount = (state: unknown): number =>
  (state as { readonly typeWorkerCounter: { readonly count: number } }).typeWorkerCounter.count;
const asyncCounter: AsyncMethodProxy<TypeWorkerCounter> =
  client.module<TypeWorkerCounter>("typeWorkerCounter");
const angularProviders = provideAngularWorkerClient(client);
const angularModuleFactory = injectAngularWorkerModule<TypeWorkerCounter>;
const angularSignal: (selector: typeof selectCount) => Signal<number> = injectAngularWorkerSignal;
const solidAccessor: Accessor<number> | undefined = undefined;
const svelteCounterStore: Readable<AsyncMethodProxy<TypeWorkerCounter>> =
  svelteWorkerModuleStore<TypeWorkerCounter>("typeWorkerCounter");
const svelteCountStore: Readable<number> = svelteWorkerSelectorStore(selectCount);
const vueCount: Readonly<Ref<number>> | undefined = undefined;

setWorkerClient(client);

void [
  asyncCounter,
  angularProviders,
  angularModuleFactory,
  angularSignal,
  solidAccessor,
  svelteCounterStore,
  svelteCountStore,
  vueCount,
  ReactWorkerClientProvider,
  useReactWorkerModule,
  useReactWorkerSelector,
  SolidWorkerClientProvider,
  useSolidWorkerModule,
  useSolidWorkerSelector,
  provideVueWorkerClient,
  useVueWorkerModule,
  useVueWorkerSelector,
];

client.dispose();
void host.dispose();
`;
}

function createRuntimeConsumerSource() {
  return `import {
  createEnvironmentInjector,
  runInInjectionContext,
} from "@angular/core";
import { renderToString } from "@vue/server-renderer";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { createRoot, getOwner, runWithOwner } from "solid-js";
import { get } from "svelte/store";
import { createSSRApp, defineComponent, h } from "vue";
import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";
import {
  injectWorkerModule as injectAngularWorkerModule,
  injectWorkerSignal as injectAngularWorkerSignal,
  provideWorkerClient as provideAngularWorkerClient,
} from "@cosystem/angular";
import {
  WorkerClientProvider as ReactWorkerClientProvider,
  useWorkerModule as useReactWorkerModule,
  useWorkerSelector as useReactWorkerSelector,
} from "@cosystem/react";
import {
  WorkerClientProvider as SolidWorkerClientProvider,
  useWorkerModule as useSolidWorkerModule,
  useWorkerSelector as useSolidWorkerSelector,
} from "@cosystem/solid";
import {
  clearWorkerClient,
  setWorkerClient,
  workerModuleStore as svelteWorkerModuleStore,
  workerSelectorStore as svelteWorkerSelectorStore,
} from "@cosystem/svelte";
import {
  provideWorkerClient as provideVueWorkerClient,
  useWorkerModule as useVueWorkerModule,
  useWorkerSelector as useVueWorkerSelector,
} from "@cosystem/vue";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class SharedWorkerCounter {
  constructor() {
    this.count = 0;
  }

  increase(step = 1) {
    this.count += step;
    return this.count;
  }
}

defineModule(SharedWorkerCounter, {
  actions: ["increase"],
  name: "installedWorkerCounter",
  state: ["count"],
});

const { client, host } = await startWorkerCounter();
let angularCounter;
let angularCount;
let angularInjector;
let reactCounter;
let reactCount = 0;
let reactRenderer;
let solidCounter;
let solidCount;
let solidDispose;
let svelteCounter;
let svelteUnsubscribe;
const svelteValues = [];
let vueCounter;
let vueCount;

try {
  function ReactView() {
    reactCounter = useReactWorkerModule("installedWorkerCounter");
    reactCount = useReactWorkerSelector(selectSharedWorkerCount);
    return createElement("span", null, reactCount);
  }

  act(() => {
    reactRenderer = create(
      createElement(ReactWorkerClientProvider, { client }, createElement(ReactView)),
    );
  });

  const VueConsumer = defineComponent({
    setup() {
      vueCounter = useVueWorkerModule("installedWorkerCounter");
      vueCount = useVueWorkerSelector(selectSharedWorkerCount);
      return () => h("span", vueCount?.value);
    },
  });
  const VueRoot = defineComponent({
    setup() {
      provideVueWorkerClient(client);
      return () => h(VueConsumer);
    },
  });

  expectEqual(await renderToString(createSSRApp(VueRoot)), "<span>0</span>", "initial Vue SSR");

  createRoot((dispose) => {
    solidDispose = dispose;
    SolidWorkerClientProvider({
      client,
      get children() {
        const owner = getOwner();

        if (owner === null) {
          throw new Error("Missing Solid owner.");
        }

        runWithOwner(owner, () => {
          solidCounter = useSolidWorkerModule("installedWorkerCounter");
          solidCount = useSolidWorkerSelector(selectSharedWorkerCount);
        });

        return undefined;
      },
    });
  });

  setWorkerClient(client);
  svelteCounter = get(svelteWorkerModuleStore("installedWorkerCounter"));
  const svelteCount = svelteWorkerSelectorStore(selectSharedWorkerCount);
  svelteUnsubscribe = svelteCount.subscribe((value) => {
    svelteValues.push(value);
  });

  angularInjector = createEnvironmentInjector([provideAngularWorkerClient(client)], null);
  runInInjectionContext(angularInjector, () => {
    angularCounter = injectAngularWorkerModule("installedWorkerCounter");
    angularCount = injectAngularWorkerSignal(selectSharedWorkerCount);
  });

  expectArrayEqual(readAdapterCounts(), [0, 0, 0, 0, 0], "initial adapter counts");
  expectRenderedSpan(reactRenderer, "0", "initial React render");

  await act(async () => {
    await angularCounter.increase(2);
  });

  expectArrayEqual(readAdapterCounts(), [2, 2, 2, 2, 2], "counts after Angular action");
  expectRenderedSpan(reactRenderer, "2", "React render after Angular action");

  await act(async () => {
    await svelteCounter.increase(3);
  });

  expectArrayEqual(readAdapterCounts(), [5, 5, 5, 5, 5], "counts after Svelte action");
  expectArrayEqual(svelteValues, [0, 2, 5], "Svelte worker store values");

  await act(async () => {
    await reactCounter.increase(1);
  });

  expectArrayEqual(readAdapterCounts(), [6, 6, 6, 6, 6], "counts after React action");

  await act(async () => {
    expectEqual(await vueCounter.increase(4), 10, "Vue worker action result");
  });

  expectArrayEqual(readAdapterCounts(), [10, 10, 10, 10, 10], "counts after Vue action");

  await act(async () => {
    expectEqual(await solidCounter.increase(5), 15, "Solid worker action result");
  });

  expectArrayEqual(readAdapterCounts(), [15, 15, 15, 15, 15], "counts after Solid action");
} finally {
  if (reactRenderer !== undefined) {
    act(() => {
      reactRenderer.unmount();
    });
  }

  svelteUnsubscribe?.();
  clearWorkerClient();
  solidDispose?.();
  angularInjector?.destroy();
  client.dispose();
  await host.dispose();
}

function readAdapterCounts() {
  return [
    reactCount,
    vueCount?.value ?? Number.NaN,
    solidCount?.() ?? Number.NaN,
    get(svelteWorkerSelectorStore(selectSharedWorkerCount, { client })),
    angularCount?.() ?? Number.NaN,
  ];
}

async function startWorkerCounter() {
  const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
  const client = createWorkerClient({
    transport: clientTransport,
  });
  const host = createWorkerApp({
    providers: [SharedWorkerCounter],
    sync: "patch",
    transport: hostTransport,
  });

  await client.ready;

  return {
    client,
    host,
  };
}

function selectSharedWorkerCount(state) {
  return state.installedWorkerCounter.count;
}

function expectEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
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

function expectRenderedSpan(renderer, expectedText, label) {
  const rendered = renderer?.toJSON();

  if (rendered?.type !== "span" || rendered.children?.[0] !== expectedText) {
    throw new Error(label + ": expected rendered span text " + expectedText);
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

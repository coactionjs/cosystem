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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-framework-adapters-"));
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
  await run(
    "pnpm",
    ["install", "--prefer-offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log("Verified installed framework adapters runtime.");
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
        name: "cosystem-framework-adapters-smoke",
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
  await writeFile(
    join(consumerDir, "pnpm-workspace.yaml"),
    createWorkspaceSource(overrides, catalog),
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

function createWorkspaceSource(overrides, catalog) {
  const lines = [
    "minimumReleaseAgeExclude:",
    `  - ${JSON.stringify(`coaction@${readCatalogVersion(catalog, "coaction")}`)}`,
    "overrides:",
  ];

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
  return `import { createApp, defineModule, type App } from "@cosystem/core";
import {
  injectModule as injectAngularModule,
  injectSignal as injectAngularSignal,
  provideCoSystem as provideAngularCoSystem,
} from "@cosystem/angular";
import {
  CoSystemProvider as ReactCoSystemProvider,
  useModule as useReactModule,
  useSelector as useReactSelector,
} from "@cosystem/react";
import {
  CoSystemProvider as SolidCoSystemProvider,
  useComputed as useSolidComputed,
  useModule as useSolidModule,
} from "@cosystem/solid";
import {
  moduleStore as svelteModuleStore,
  selectedModuleStore as selectedSvelteModuleStore,
  setCoSystemApp,
} from "@cosystem/svelte";
import {
  provideCoSystem as provideVueCoSystem,
  useComputed as useVueComputed,
  useModule as useVueModule,
} from "@cosystem/vue";
import type { Signal } from "@angular/core";
import type { Accessor } from "solid-js";
import type { Readable } from "svelte/store";
import type { Ref } from "vue";

class TypeFrameworkCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }

  async increaseLater(step = 1): Promise<number> {
    await Promise.resolve();
    this.count += step;
    return this.count;
  }
}

defineModule(TypeFrameworkCounter, {
  actions: ["increase", "increaseLater"],
  name: "typeFrameworkCounter",
  state: ["count"],
});

const app: App = createApp({
  providers: [TypeFrameworkCounter],
});
const moduleSelector = (module: TypeFrameworkCounter): number => module.count;
const appSelector = (runtime: App): number => runtime.getModule(TypeFrameworkCounter).count;
const angularProviders = provideAngularCoSystem(app);
const angularModuleFactory = injectAngularModule<TypeFrameworkCounter>;
const angularSignalFactory: (
  token: typeof TypeFrameworkCounter,
  selector: typeof moduleSelector,
) => Signal<number> = injectAngularSignal;
const solidAccessor: Accessor<number> | undefined = undefined;
const svelteCounterStore: Readable<TypeFrameworkCounter> = svelteModuleStore(TypeFrameworkCounter, app);
const svelteCountStore: Readable<number> = selectedSvelteModuleStore(
  TypeFrameworkCounter,
  moduleSelector,
  { app },
);
const vueCount: Readonly<Ref<number>> | undefined = undefined;

setCoSystemApp(app);

void [
  angularProviders,
  angularModuleFactory,
  angularSignalFactory,
  solidAccessor,
  svelteCounterStore,
  svelteCountStore,
  vueCount,
  ReactCoSystemProvider,
  useReactModule,
  useReactSelector,
  SolidCoSystemProvider,
  useSolidModule,
  useSolidComputed,
  provideVueCoSystem,
  useVueModule,
  useVueComputed,
  appSelector,
];
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
import { createApp, defineModule } from "@cosystem/core";
import {
  injectModule as injectAngularModule,
  injectSignal as injectAngularSignal,
  provideCoSystem as provideAngularCoSystem,
} from "@cosystem/angular";
import {
  CoSystemProvider as ReactCoSystemProvider,
  useModule as useReactModule,
  useSelector as useReactSelector,
} from "@cosystem/react";
import {
  CoSystemProvider as SolidCoSystemProvider,
  useComputed as useSolidComputed,
  useModule as useSolidModule,
} from "@cosystem/solid";
import {
  clearCoSystemApp,
  moduleStore as svelteModuleStore,
  selectedModuleStore as selectedSvelteModuleStore,
  setCoSystemApp,
} from "@cosystem/svelte";
import {
  provideCoSystem as provideVueCoSystem,
  useComputed as useVueComputed,
  useModule as useVueModule,
} from "@cosystem/vue";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class SharedCounter {
  constructor() {
    this.count = 0;
  }

  increase(step = 1) {
    this.count += step;
    return this.count;
  }

  async increaseLater(step = 1) {
    await Promise.resolve();
    this.count += step;
    return this.count;
  }
}

defineModule(SharedCounter, {
  actions: ["increase", "increaseLater"],
  name: "installedFrameworkCounter",
  state: ["count"],
});

const app = createApp({
  providers: [SharedCounter],
});
const counter = app.getModule(SharedCounter);
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
    reactCounter = useReactModule(SharedCounter);
    reactCount = useReactSelector(SharedCounter, (module) => module.count);
    return createElement("span", null, reactCount);
  }

  act(() => {
    reactRenderer = create(
      createElement(ReactCoSystemProvider, { app }, createElement(ReactView)),
    );
  });

  const VueConsumer = defineComponent({
    setup() {
      vueCounter = useVueModule(SharedCounter);
      vueCount = useVueComputed((runtime) => runtime.getModule(SharedCounter).count);
      return () => h("span", vueCount?.value);
    },
  });
  const VueRoot = defineComponent({
    setup() {
      provideVueCoSystem(app);
      return () => h(VueConsumer);
    },
  });

  expectEqual(await renderToString(createSSRApp(VueRoot)), "<span>0</span>", "initial Vue SSR");

  createRoot((dispose) => {
    solidDispose = dispose;
    SolidCoSystemProvider({
      app,
      get children() {
        const owner = getOwner();

        if (owner === null) {
          throw new Error("Missing Solid owner.");
        }

        runWithOwner(owner, () => {
          solidCounter = useSolidModule(SharedCounter);
          solidCount = useSolidComputed(SharedCounter, (module) => module.count);
        });

        return undefined;
      },
    });
  });

  setCoSystemApp(app);
  svelteCounter = get(svelteModuleStore(SharedCounter));
  const svelteCount = selectedSvelteModuleStore(SharedCounter, (module) => module.count);
  svelteUnsubscribe = svelteCount.subscribe((value) => {
    svelteValues.push(value);
  });

  angularInjector = createEnvironmentInjector([provideAngularCoSystem(app)], null);
  runInInjectionContext(angularInjector, () => {
    angularCounter = injectAngularModule(SharedCounter);
    angularCount = injectAngularSignal(SharedCounter, (module) => module.count);
  });

  expectSame(reactCounter, counter, "React module identity");
  expectSame(vueCounter, counter, "Vue module identity");
  expectSame(solidCounter, counter, "Solid module identity");
  expectSame(svelteCounter, counter, "Svelte module identity");
  expectSame(angularCounter, counter, "Angular module identity");
  expectArrayEqual(readAdapterCounts(), [0, 0, 0, 0, 0], "initial adapter counts");
  expectRenderedSpan(reactRenderer, "0", "initial React render");

  act(() => {
    angularCounter.increase(2);
  });

  expectArrayEqual(readAdapterCounts(), [2, 2, 2, 2, 2], "counts after Angular action");
  expectRenderedSpan(reactRenderer, "2", "React render after Angular action");

  act(() => {
    svelteCounter.increase(3);
  });

  expectArrayEqual(readAdapterCounts(), [5, 5, 5, 5, 5], "counts after Svelte action");
  expectArrayEqual(svelteValues, [0, 2, 5], "Svelte store sync values");

  await act(async () => {
    expectEqual(await reactCounter.increaseLater(4), 9, "React async action result");
  });

  expectArrayEqual(readAdapterCounts(), [9, 9, 9, 9, 9], "counts after React async action");
  expectRenderedSpan(reactRenderer, "9", "React render after React async action");

  await act(async () => {
    expectEqual(await vueCounter.increaseLater(5), 14, "Vue async action result");
  });

  expectArrayEqual(readAdapterCounts(), [14, 14, 14, 14, 14], "counts after Vue async action");

  await act(async () => {
    expectEqual(await solidCounter.increaseLater(6), 20, "Solid async action result");
  });

  expectArrayEqual(readAdapterCounts(), [20, 20, 20, 20, 20], "counts after Solid async action");

  await act(async () => {
    expectEqual(await angularCounter.increaseLater(7), 27, "Angular async action result");
  });

  expectArrayEqual(readAdapterCounts(), [27, 27, 27, 27, 27], "counts after Angular async action");

  await act(async () => {
    expectEqual(await svelteCounter.increaseLater(8), 35, "Svelte async action result");
  });

  expectArrayEqual(readAdapterCounts(), [35, 35, 35, 35, 35], "counts after Svelte async action");
  expectArrayEqual(svelteValues, [0, 2, 5, 9, 14, 20, 27, 35], "Svelte async store values");
} finally {
  if (reactRenderer !== undefined) {
    act(() => {
      reactRenderer.unmount();
    });
  }

  svelteUnsubscribe?.();
  clearCoSystemApp();
  solidDispose?.();
  angularInjector?.destroy();
}

function readAdapterCounts() {
  return [
    reactCount,
    vueCount?.value ?? Number.NaN,
    solidCount?.() ?? Number.NaN,
    get(selectedSvelteModuleStore(SharedCounter, (module) => module.count, { app })),
    angularCount?.() ?? Number.NaN,
  ];
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

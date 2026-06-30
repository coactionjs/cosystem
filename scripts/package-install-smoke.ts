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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-package-install-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const catalog = await readCatalog();
  const packages = await readPublicPackages();
  const tarballByName = new Map();

  await mkdir(tarballsDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });

  for (const pkg of packages) {
    tarballByName.set(pkg.packageJson.name, await packPackage(pkg));
  }

  await writeConsumerProject(packages, tarballByName, catalog);
  await run(
    "pnpm",
    ["install", "--offline", "--no-frozen-lockfile", "--ignore-scripts"],
    consumerDir,
  );
  await run(tscBin, ["-p", "tsconfig.json"], consumerDir);
  await run(process.execPath, ["runtime.mjs"], consumerDir);

  console.log(`Verified installed tarballs for ${packages.length} public package(s).`);
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function readPublicPackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(packagesDir, entry.name);
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));

    if (packageJson.private === true) {
      continue;
    }

    packages.push({
      dir,
      packageJson,
    });
  }

  return packages.toSorted((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  );
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

async function packPackage(pkg) {
  const destination = join(
    tarballsDir,
    pkg.packageJson.name.replaceAll("@", "").replaceAll("/", "__"),
  );

  await mkdir(destination, { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", destination], pkg.dir);

  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`${pkg.packageJson.name} must produce exactly one tarball.`);
  }

  return join(destination, tarballs[0]);
}

async function writeConsumerProject(packages, tarballByName, catalog) {
  const dependencies = {};
  const overrides = {};

  for (const pkg of packages) {
    const tarballSpec = `file:${tarballByName.get(pkg.packageJson.name)}`;

    dependencies[pkg.packageJson.name] = tarballSpec;
    overrides[pkg.packageJson.name] = tarballSpec;

    for (const [name, range] of getRuntimeDependencyEntries(pkg.packageJson)) {
      if (name.startsWith("@cosystem/")) {
        continue;
      }

      dependencies[name] = resolveDependencyVersion(name, range, catalog);
    }
  }

  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-package-install-smoke",
        private: true,
        type: "module",
        dependencies: sortObject(dependencies),
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

function getRuntimeDependencyEntries(packageJson) {
  const entries = [];

  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];

    if (dependencies === undefined) {
      continue;
    }

    entries.push(...Object.entries(dependencies));
  }

  return entries;
}

function resolveDependencyVersion(name, range, catalog) {
  if (range === "catalog:") {
    const version = catalog.get(name);

    if (version === undefined) {
      throw new Error(`${name} uses catalog: but is missing from pnpm-workspace.yaml.`);
    }

    return version;
  }

  const catalogVersion = catalog.get(name);
  return catalogVersion ?? range;
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function createWorkspaceSource(overrides) {
  const lines = ["overrides:"];

  for (const [name, value] of Object.entries(sortObject(overrides))) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  }

  return `${lines.join("\n")}\n`;
}

function createTypeConsumerSource() {
  return `import { provideCoSystem, injectSignal } from "@cosystem/angular";
import { createApp, defineModule, provide } from "@cosystem/core";
import { createCosystemProject } from "@cosystem/create";
import { createDevtoolsPlugin } from "@cosystem/devtools";
import { CoSystemProvider, useSelector } from "@cosystem/react";
import { createMemoryRouter, createRouterPlugin } from "@cosystem/router";
import { CoSystemProvider as SolidCoSystemProvider, useComputed } from "@cosystem/solid";
import {
  createLocalSpaceStorage,
  createLocalSpaceStoragePlugin,
  type StorageService,
} from "@cosystem/storage";
import { moduleRune } from "@cosystem/svelte/runes";
import { moduleStore, setCoSystemApp } from "@cosystem/svelte";
import { testApp } from "@cosystem/testing";
import { cosystemPlugin, useComputed as useVueComputed } from "@cosystem/vue";

class Counter {
  count = 0;
}

defineModule(Counter, {
  name: "counter",
  state: ["count"],
});

const app = createApp({
  plugins: [
    createDevtoolsPlugin(),
    createRouterPlugin(createMemoryRouter()),
    createLocalSpaceStoragePlugin({ hydrate: false, persist: false }),
  ],
  providers: [Counter, provide("value", { useValue: 1 })],
});
const storage: StorageService = createLocalSpaceStorage();

void [
  app,
  storage,
  provideCoSystem,
  injectSignal,
  createCosystemProject,
  CoSystemProvider,
  useSelector,
  SolidCoSystemProvider,
  useComputed,
  moduleStore,
  moduleRune,
  setCoSystemApp,
  testApp,
  cosystemPlugin,
  useVueComputed,
];
`;
}

function createRuntimeConsumerSource() {
  return `import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requiredExports = {
  "@cosystem/angular": ["provideCoSystem", "injectSignal"],
  "@cosystem/core": ["createApp", "defineModule", "provide"],
  "@cosystem/create": ["createCosystemProject"],
  "@cosystem/devtools": ["createDevtoolsPlugin"],
  "@cosystem/react": ["CoSystemProvider", "useSelector"],
  "@cosystem/router": ["createMemoryRouter", "createRouterPlugin"],
  "@cosystem/solid": ["CoSystemProvider", "useComputed"],
  "@cosystem/storage": ["createLocalSpaceStorage", "createLocalSpaceStoragePlugin"],
  "@cosystem/svelte": ["moduleStore", "setCoSystemApp"],
  "@cosystem/svelte/runes": ["moduleRune"],
  "@cosystem/testing": ["testApp"],
  "@cosystem/vue": ["cosystemPlugin", "useComputed"],
};
const modules = {};

for (const [specifier, exports] of Object.entries(requiredExports)) {
  const module = await import(specifier);
  modules[specifier] = module;

  for (const name of exports) {
    if (typeof module[name] !== "function") {
      throw new Error(\`\${specifier} is missing runtime export \${name}.\`);
    }
  }
}

const {
  createApp,
  defineModule,
} = modules["@cosystem/core"];

class Counter {
  count = 0;

  increase() {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "counter",
  state: ["count"],
});

const devtools = modules["@cosystem/devtools"].createDevtoolsPlugin();
const router = modules["@cosystem/router"].createMemoryRouter();
const storage = modules["@cosystem/storage"].createLocalSpaceStorage({
  options: {
    driver: "memoryStorageWrapper",
    name: "cosystem-package-install-smoke",
    storeName: "state",
  },
});
const app = createApp({
  plugins: [
    devtools,
    modules["@cosystem/router"].createRouterPlugin(router),
    modules["@cosystem/storage"].createLocalSpaceStoragePlugin({
      hydrate: false,
      persist: false,
      service: storage,
    }),
  ],
  providers: [Counter],
});

await app.start();
app.getModule(Counter).increase();
router.navigate("/settings?tab=profile#advanced");
await storage.set("counter", app.store.getPureState());

if (app.store.getPureState().counter.count !== 1) {
  throw new Error("Installed @cosystem/core did not update module state.");
}

if (router.current.path !== "/settings" || router.current.search !== "?tab=profile") {
  throw new Error("Installed @cosystem/router did not parse navigation.");
}

if ((await storage.get("counter")).counter.count !== 1) {
  throw new Error("Installed @cosystem/storage did not round-trip state.");
}

if (!devtools.getTimeline().some((event) => event.type === "action:end")) {
  throw new Error("Installed @cosystem/devtools did not observe actions.");
}

const test = modules["@cosystem/testing"].testApp({
  providers: [Counter],
});
test.getModule(Counter).increase();

if (test.test.getState().counter.count !== 1) {
  throw new Error("Installed @cosystem/testing did not expose test app state.");
}

await test.dispose();
await app.dispose();
await storage.destroy();

const projectDir = await mkdtemp(join(tmpdir(), "cosystem-installed-create-"));

try {
  const created = await modules["@cosystem/create"].createCosystemProject({
    name: "installed-create-smoke",
    root: projectDir,
  });

  if (!created.files.includes("src/main.ts")) {
    throw new Error("Installed @cosystem/create did not scaffold main source.");
  }
} finally {
  await rm(projectDir, { force: true, recursive: true });
}
`;
}

async function run(command, args, cwd) {
  try {
    await execFileAsync(command, args, {
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

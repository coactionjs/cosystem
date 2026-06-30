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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-core-plugin-providers-"));
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

  console.log("Verified installed core plugin provider runtime.");
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
        name: "cosystem-core-plugin-providers-smoke",
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
  createApp,
  defineModule,
  inject,
  provide,
  token,
  type App,
  type Plugin,
} from "@cosystem/core";

const ConfigToken = token<{ readonly label: string }>("TypePluginConfig");
const ExtensionToken = token<{ readonly name: string }>("TypePluginExtension");

class TypeConfigReader {
  constructor(readonly config: { readonly label: string }) {}
}

defineModule(TypeConfigReader, {
  deps: [ConfigToken],
  name: "typeConfigReader",
});

const events: string[] = [];
const plugin: Plugin = {
  name: "type-config",
  providers: [
    provide(ConfigToken, { useValue: { label: "plugin" } }),
    provide(ExtensionToken, { multi: true, useValue: { name: "plugin" } }),
  ],
  setup() {
    events.push(inject(ConfigToken).label);
  },
};
const app: App = createApp({
  plugins: [plugin],
  providers: [
    TypeConfigReader,
    provide(ExtensionToken, { multi: true, useValue: { name: "app" } }),
  ],
});

await app.start();

const config: { readonly label: string } = app.get(ConfigToken);
const reader: TypeConfigReader = app.getModule(TypeConfigReader);
const extensions: Array<{ readonly name: string }> = app.getAll(ExtensionToken);

void [config, events, extensions, reader];
`;
}

function createRuntimeConsumerSource() {
  return `import {
  DuplicateProviderError,
  createApp,
  defineModule,
  inject,
  provide,
  token,
} from "@cosystem/core";

await verifyPluginProviderOrdering();
await verifyAppProviderPrecedence();
verifyPluginProviderErrors();

async function verifyPluginProviderOrdering() {
  const Config = token("Config");
  const events = [];

  class ConfigReader {
    constructor(config) {
      this.config = config;
    }
  }

  defineModule(ConfigReader, {
    deps: [Config],
    name: "configReader",
  });

  const app = createApp({
    plugins: [
      {
        name: "config",
        providers: [
          provide(Config, {
            useValue: { label: "plugin" },
          }),
        ],
        setup() {
          events.push(inject(Config).label);
        },
      },
    ],
    providers: [ConfigReader],
  });

  await app.start();

  expectJsonEqual(app.get(Config), { label: "plugin" }, "plugin provider is registered");
  expectJsonEqual(
    app.getModule(ConfigReader).config,
    { label: "plugin" },
    "plugin provider is available to modules",
  );
  expectJsonEqual(events, ["plugin"], "plugin provider is available to setup inject");

  await app.dispose();
}

async function verifyAppProviderPrecedence() {
  const Config = token("OverrideConfig");
  const ReplaceableExtension = token("ReplaceableExtension");
  const Extension = token("Extension");

  const overrideApp = createApp({
    plugins: [
      {
        providers: [
          provide(Config, {
            useValue: { label: "plugin" },
          }),
        ],
      },
    ],
    providers: [
      provide(Config, {
        useValue: { label: "app" },
      }),
    ],
  });

  expectJsonEqual(overrideApp.get(Config), { label: "app" }, "app provider overrides plugin");

  await overrideApp.dispose();

  const replaceApp = createApp({
    plugins: [
      {
        providers: [
          provide(ReplaceableExtension, {
            multi: true,
            useValue: { name: "plugin:first" },
          }),
        ],
      },
      {
        providers: [
          provide(ReplaceableExtension, {
            multi: true,
            useValue: { name: "plugin:second" },
          }),
        ],
      },
    ],
    providers: [
      provide(ReplaceableExtension, {
        useValue: { name: "app" },
      }),
    ],
  });

  expectJsonEqual(replaceApp.get(ReplaceableExtension), { name: "app" }, "app non-multi wins");
  expectJsonEqual(
    replaceApp.getAll(ReplaceableExtension),
    [{ name: "app" }],
    "app non-multi replaces plugin multi records",
  );

  await replaceApp.dispose();

  const mergeApp = createApp({
    plugins: [
      {
        providers: [
          provide(Extension, {
            multi: true,
            useValue: { name: "plugin:first" },
          }),
        ],
      },
      {
        providers: [
          provide(Extension, {
            multi: true,
            useValue: { name: "plugin:second" },
          }),
        ],
      },
    ],
    providers: [
      provide(Extension, {
        multi: true,
        useValue: { name: "app" },
      }),
    ],
  });

  expectJsonEqual(
    mergeApp.getAll(Extension).map((extension) => extension.name),
    ["plugin:first", "plugin:second", "app"],
    "plugin and app multi providers merge in order",
  );

  await mergeApp.dispose();
}

function verifyPluginProviderErrors() {
  const Config = token("DuplicateConfig");

  expectThrowsInstance(
    () =>
      createApp({
        plugins: [
          {
            name: "first",
            providers: [
              provide(Config, {
                useValue: { label: "first" },
              }),
            ],
          },
          {
            name: "second",
            providers: [
              provide(Config, {
                useValue: { label: "second" },
              }),
            ],
          },
        ],
      }),
    DuplicateProviderError,
    "duplicate non-multi providers across plugins",
  );

  class PluginModule {
    constructor() {
      this.value = true;
    }
  }

  defineModule(PluginModule, {
    name: "pluginModule",
  });

  expectThrowsMessage(
    () =>
      createApp({
        plugins: [
          {
            name: "bad",
            providers: [PluginModule],
          },
        ],
      }),
    "bad cannot register CoSystem modules through plugin providers",
    "plugin direct module providers are rejected",
  );

  class IndirectPluginModule {
    constructor() {
      this.value = true;
    }
  }

  defineModule(IndirectPluginModule, {
    name: "indirectPluginModule",
  });

  const PluginService = token("PluginService");

  expectThrowsMessage(
    () =>
      createApp({
        plugins: [
          {
            name: "bad",
            providers: [
              provide(PluginService, {
                useClass: IndirectPluginModule,
              }),
            ],
          },
        ],
      }),
    "bad cannot register CoSystem modules through plugin providers",
    "plugin useClass module providers are rejected",
  );
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

function expectThrowsMessage(callback, message, label) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(message)) {
      return error;
    }

    throw new Error(label + ": expected " + message + ", got " + formatError(error));
  }

  throw new Error(label + ": expected error containing " + message);
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

#!/usr/bin/env node
/* eslint-disable no-underscore-dangle */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-plugin-stack-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const devtoolsTarball = await packPackage("@cosystem/devtools");
  const routerTarball = await packPackage("@cosystem/router");
  const storageTarball = await packPackage("@cosystem/storage");

  await writeConsumerProject({
    catalog,
    coreTarball,
    devtoolsTarball,
    routerTarball,
    storageTarball,
  });
  await run("pnpm", ["install", "--offline"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runPluginStackSmoke(browser, server.url);

  console.log("Verified installed plugin stack browser integration.");
} finally {
  await browser?.close();
  await server?.close();
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

async function writeConsumerProject({
  catalog,
  coreTarball,
  devtoolsTarball,
  routerTarball,
  storageTarball,
}) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-plugin-stack-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/devtools": `file:${devtoolsTarball}`,
          "@cosystem/router": `file:${routerTarball}`,
          "@cosystem/storage": `file:${storageTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          localspace: readCatalogVersion(catalog, "localspace"),
        },
        devDependencies: {
          typescript: readCatalogVersion(catalog, "typescript"),
          vite: readCatalogVersion(catalog, "vite"),
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
      "allowBuilds:",
      '  "@parcel/watcher": true',
      "  esbuild: true",
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "@cosystem/devtools": ${JSON.stringify(`file:${devtoolsTarball}`)}`,
      `  "@cosystem/router": ${JSON.stringify(`file:${routerTarball}`)}`,
      `  "@cosystem/storage": ${JSON.stringify(`file:${storageTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "localspace": ${JSON.stringify(readCatalogVersion(catalog, "localspace"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      `  "vite": ${JSON.stringify(readCatalogVersion(catalog, "vite"))}`,
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
        include: ["src/main.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDir, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "    <title>CoSystem plugin stack browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Plugin stack smoke">',
      "      <h1>Plugin stack browser smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Count</dt><dd id="count">0</dd></div>',
      '        <div><dt>Path</dt><dd id="path">/</dd></div>',
      '        <div><dt>Search</dt><dd id="search">-</dd></div>',
      '        <div><dt>Hash</dt><dd id="hash">-</dd></div>',
      '        <div><dt>Stored count</dt><dd id="stored-count">empty</dd></div>',
      '        <div><dt>Stored path</dt><dd id="stored-path">empty</dd></div>',
      '        <div><dt>Storage provider</dt><dd id="storage-provider">false</dd></div>',
      '        <div><dt>Router provider</dt><dd id="router-provider">false</dd></div>',
      '        <div><dt>Last event</dt><dd id="last-event">none</dd></div>',
      "      </dl>",
      '      <button type="button" id="settings">Settings</button>',
      '      <button type="button" id="increase">Increase</button>',
      "    </main>",
      '    <script type="module" src="/src/main.ts"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
  );
  await writeFile(join(consumerDir, "src/main.ts"), createBrowserSource());
}

function createBrowserSource() {
  return `import { createApp, defineModule } from "@cosystem/core";
import { createDevtoolsPlugin } from "@cosystem/devtools";
import {
  RouterToken,
  createBrowserRouter,
  createRouterPlugin,
  formatLocation,
} from "@cosystem/router";
import {
  StorageToken,
  createLocalSpaceStoragePlugin,
  localStorageDriver,
} from "@cosystem/storage";

type ShellState = {
  readonly shell?: {
    readonly count?: number;
    readonly path?: string;
  };
};

type PluginStackSnapshot = {
  readonly actionMethods: readonly string[];
  readonly count: number;
  readonly driver: string | null;
  readonly hash: string;
  readonly hasRawState: boolean;
  readonly path: string;
  readonly patchCount: number;
  readonly routePath: string;
  readonly routeSearch: string;
  readonly routeHash: string;
  readonly routerProvided: boolean;
  readonly search: string;
  readonly statePaths: readonly (string | null)[];
  readonly storageProvided: boolean;
  readonly storedCount: number | null;
  readonly storedPath: string | null;
  readonly timelineTypes: readonly string[];
};

declare global {
  interface Window {
    __cosystemPluginStackSmoke?: {
      readonly ready: Promise<void>;
      increase(): Promise<PluginStackSnapshot>;
      navigate(to: string): Promise<PluginStackSnapshot>;
      read(): Promise<PluginStackSnapshot>;
    };
  }
}

const storageName = "cosystem-plugin-stack-browser-smoke";
const storageStoreName = "state";
const storageKey = "app";
const rawStorageKey = \`\${storageName}/\${storageStoreName}/\${storageKey}\`;

class Shell {
  count = 0;
  path = "/";

  increase(): number {
    this.count += 1;
    return this.count;
  }
}

defineModule(Shell, {
  actions: ["increase"],
  name: "shell",
  state: ["count", "path"],
});

const devtools = createDevtoolsPlugin();
const router = createBrowserRouter();
const storagePlugin = createLocalSpaceStoragePlugin<ShellState>({
  key: storageKey,
  merge: mergeShellState,
  options: {
    driver: localStorageDriver._driver,
    name: storageName,
    storeName: storageStoreName,
  },
});
const app = createApp({
  plugins: [
    devtools,
    storagePlugin,
    createRouterPlugin(router, {
      immediate: true,
      onChange(location, runtime) {
        runtime.runInAction(
          Shell,
          () => {
            runtime.getModule(Shell).path = location.path;
          },
          {
            args: [formatLocation(location)],
            name: "router.navigate",
          },
        );
      },
    }),
  ],
  providers: [Shell],
});

let shell: Shell;

const ready = start();

window.__cosystemPluginStackSmoke = {
  ready,
  increase,
  navigate,
  read,
};

getElement<HTMLButtonElement>("settings").addEventListener("click", () => {
  void runButtonAction(() => navigate("/settings?tab=security#advanced"));
});
getElement<HTMLButtonElement>("increase").addEventListener("click", () => {
  void runButtonAction(increase);
});

async function start(): Promise<void> {
  await app.start();
  shell = app.getModule(Shell);
  await storagePlugin.flush();
  await render("ready");
}

async function navigate(to: string): Promise<PluginStackSnapshot> {
  router.navigate(to);
  await storagePlugin.flush();
  await render("ready");
  return await read();
}

async function increase(): Promise<PluginStackSnapshot> {
  shell.increase();
  await storagePlugin.flush();
  await render("ready");
  return await read();
}

async function read(): Promise<PluginStackSnapshot> {
  const stored = await storagePlugin.storage.get<ShellState>(storageKey);
  const timeline = devtools.getTimeline();

  return {
    actionMethods: timeline.flatMap((event) =>
      event.type === "action:start" || event.type === "action:end" ? [event.event.method] : [],
    ),
    count: shell.count,
    driver: storagePlugin.storage.driver(),
    hash: router.current.hash === "" ? "-" : router.current.hash,
    hasRawState: localStorage.getItem(rawStorageKey) !== null,
    path: shell.path,
    patchCount: timeline.filter((event) => event.type === "patch").length,
    routeHash: router.current.hash,
    routePath: router.current.path,
    routeSearch: router.current.search,
    routerProvided: app.get(RouterToken) === router,
    search: router.current.search === "" ? "-" : router.current.search,
    statePaths: timeline.flatMap((event) => {
      if (event.type !== "state") {
        return [];
      }

      const state = event.event.state as ShellState;
      return [state.shell?.path ?? null];
    }),
    storageProvided: app.get(StorageToken) === storagePlugin.storage,
    storedCount: stored?.shell?.count ?? null,
    storedPath: stored?.shell?.path ?? null,
    timelineTypes: timeline.map((event) => event.type),
  };
}

async function render(status: string): Promise<void> {
  const snapshot = await read();

  getElement("status").textContent = status;
  getElement("count").textContent = String(snapshot.count);
  getElement("path").textContent = snapshot.path;
  getElement("search").textContent = snapshot.search;
  getElement("hash").textContent = snapshot.hash;
  getElement("stored-count").textContent =
    snapshot.storedCount === null ? "empty" : String(snapshot.storedCount);
  getElement("stored-path").textContent = snapshot.storedPath ?? "empty";
  getElement("storage-provider").textContent = String(snapshot.storageProvided);
  getElement("router-provider").textContent = String(snapshot.routerProvided);
  getElement("last-event").textContent = snapshot.timelineTypes.at(-1) ?? "none";
}

async function runButtonAction(action: () => Promise<PluginStackSnapshot>): Promise<void> {
  await action();
}

function mergeShellState(persisted: ShellState, current: unknown): ShellState {
  const currentShell = (current as ShellState).shell;

  return {
    shell: {
      count: persisted.shell?.count ?? currentShell?.count ?? 0,
      path: persisted.shell?.path ?? currentShell?.path ?? "/",
    },
  };
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(\`Missing element #\${id}.\`);
  }

  return element as T;
}
`;
}

async function runPluginStackSmoke(browserInstance, url) {
  const context = await browserInstance.newContext();
  const page = await context.newPage();
  const errors = [];

  page.on("pageerror", (error) => {
    errors.push(error.stack ?? error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => window.__cosystemPluginStackSmoke?.ready);
    await expectText(page, "h1", "Plugin stack browser smoke");
    await expectStat(page, "Status", "ready");

    const initial = await readSmokeSnapshot(page);
    assertSnapshot(initial, {
      count: 0,
      path: "/",
      routeHash: "",
      routePath: "/",
      routeSearch: "",
      routerProvided: true,
      storageProvided: true,
    });
    assertIncludes(initial.timelineTypes, "setup", "initial timeline types");
    assertIncludes(initial.timelineTypes, "module", "initial timeline types");

    const afterNavigate = await callSmoke(page, "navigate", "/settings?tab=security#advanced");

    assertSnapshot(afterNavigate, {
      count: 0,
      path: "/settings",
      routeHash: "#advanced",
      routePath: "/settings",
      routeSearch: "?tab=security",
      routerProvided: true,
      storageProvided: true,
      storedPath: "/settings",
    });
    assertIncludes(afterNavigate.actionMethods, "router.navigate", "action methods after route");
    assertIncludes(afterNavigate.statePaths, "/settings", "state paths after route");
    await expectStat(page, "Path", "/settings");
    await expectStat(page, "Search", "?tab=security");
    await expectStat(page, "Hash", "#advanced");

    const afterIncrease = await callSmoke(page, "increase");

    assertSnapshot(afterIncrease, {
      count: 1,
      path: "/settings",
      routeHash: "#advanced",
      routePath: "/settings",
      routeSearch: "?tab=security",
      storedCount: 1,
      storedPath: "/settings",
    });
    assertIncludes(afterIncrease.actionMethods, "increase", "action methods after increase");
    assertAtLeast(afterIncrease.patchCount, 2, "patch count after route and increase");
    await expectStat(page, "Count", "1");
    await expectStat(page, "Stored count", "1");
    await expectStat(page, "Stored path", "/settings");

    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => window.__cosystemPluginStackSmoke?.ready);

    const afterReload = await readSmokeSnapshot(page);
    assertSnapshot(afterReload, {
      count: 1,
      path: "/settings",
      routeHash: "#advanced",
      routePath: "/settings",
      routeSearch: "?tab=security",
      routerProvided: true,
      storageProvided: true,
      storedCount: 1,
      storedPath: "/settings",
    });
    await expectStat(page, "Count", "1");
    await expectStat(page, "Path", "/settings");

    const afterSecondIncrease = await callSmoke(page, "increase");

    assertSnapshot(afterSecondIncrease, {
      count: 2,
      path: "/settings",
      storedCount: 2,
      storedPath: "/settings",
    });
    assertIncludes(afterSecondIncrease.timelineTypes, "patch", "timeline types after reload");
    await expectStat(page, "Count", "2");
    await expectStat(page, "Stored count", "2");

    if (errors.length > 0) {
      throw new Error(`Installed plugin stack smoke emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
}

async function readSmokeSnapshot(page) {
  return await page.evaluate(async () => {
    const smoke = window.__cosystemPluginStackSmoke;

    if (smoke === undefined) {
      throw new Error("Plugin stack smoke API was not registered.");
    }

    return await smoke.read();
  });
}

async function callSmoke(page, method, ...args) {
  return await page.evaluate(
    async ({ callArgs, methodName }) => {
      const smoke = window.__cosystemPluginStackSmoke;

      if (smoke === undefined) {
        throw new Error("Plugin stack smoke API was not registered.");
      }

      const action = smoke[methodName];

      if (typeof action !== "function") {
        throw new Error(`Plugin stack smoke method ${methodName} is missing.`);
      }

      return await action(...callArgs);
    },
    { callArgs: args, methodName: method },
  );
}

function assertSnapshot(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(
        `Expected snapshot.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(
          actual[key],
        )}. Snapshot: ${JSON.stringify(actual)}`,
      );
    }
  }
}

function assertIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label} must include ${JSON.stringify(expected)}: ${JSON.stringify(values)}`);
  }
}

function assertAtLeast(value, minimum, label) {
  if (value < minimum) {
    throw new Error(`${label} must be at least ${minimum}, got ${value}.`);
  }
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      executablePath: chromeExecutable,
      headless: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(
      [
        "Unable to launch Chromium for installed plugin stack browser smoke.",
        "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to a Chromium/Chrome binary, or run `pnpm exec playwright install chromium`.",
        detail,
      ].join("\n"),
      { cause: error },
    );
  }
}

async function createStaticServer(root) {
  const indexPath = join(root, "index.html");

  await assertReadableFile(indexPath);

  const serverInstance = createServer(async (request, response) => {
    try {
      if (new URL(request.url ?? "/", "http://127.0.0.1").pathname === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }

      const filePath = await resolveRequestPathWithFallback(root, request.url ?? "/");
      const body = await readFile(filePath);

      response.writeHead(200, {
        "Content-Type": contentType(filePath),
      });
      response.end(body);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end(error instanceof Error ? error.message : "Internal server error");
    }
  });

  await new Promise((done, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", done);
  });

  const address = serverInstance.address();

  if (address === null || typeof address === "string") {
    throw new Error("Static server did not expose a TCP address.");
  }

  return {
    close() {
      return new Promise((done, reject) => {
        serverInstance.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          done();
        });
      });
    },
    url: `http://127.0.0.1:${address.port}/`,
  };
}

async function resolveRequestPathWithFallback(root, requestUrl) {
  try {
    return await resolveRequestPath(root, requestUrl);
  } catch (error) {
    const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;

    if (error?.code === "ENOENT" && extname(pathname) === "") {
      return join(root, "index.html");
    }

    throw error;
  }
}

async function resolveRequestPath(root, requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(root, `.${decodeURIComponent(pathname)}`);
  const normalizedRoot = `${normalize(root)}${root.endsWith("/") ? "" : "/"}`;

  if (!normalize(filePath).startsWith(normalizedRoot)) {
    throw Object.assign(new Error("Forbidden path."), { code: "ENOENT" });
  }

  const fileStat = await stat(filePath);

  if (fileStat.isDirectory()) {
    return join(filePath, "index.html");
  }

  return filePath;
}

async function expectText(page, selector, expected) {
  await page.waitForFunction(
    ({ selector: cssSelector, expectedText }) => {
      const element = document.querySelector(cssSelector);
      return element?.textContent?.includes(expectedText) ?? false;
    },
    { expectedText: expected, selector },
  );
}

async function expectStat(page, label, expected) {
  await page.waitForFunction(
    ({ expectedValue, labelText }) => {
      const labels = [...document.querySelectorAll("dt")];
      const labelElement = labels.find((element) => element.textContent?.trim() === labelText);
      const valueElement = labelElement?.parentElement?.querySelector("dd");

      return valueElement?.textContent?.trim() === expectedValue;
    },
    { expectedValue: expected, labelText: label },
  );
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function assertReadableFile(path) {
  const fileStat = await stat(path);

  if (!fileStat.isFile()) {
    throw new Error(`Missing built plugin stack smoke asset: ${path}`);
  }
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

function findSystemChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (canReadSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function canReadSync(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

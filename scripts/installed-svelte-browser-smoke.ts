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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-svelte-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const svelteTarball = await packPackage("@cosystem/svelte");

  await writeConsumerProject({ catalog, coreTarball, svelteTarball });
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runSvelteBrowserSmoke(browser, server.url);

  console.log("Verified installed Svelte adapter browser DOM integration.");
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

async function writeConsumerProject({ catalog, coreTarball, svelteTarball }) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-svelte-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "svelte-check --tsconfig ./tsconfig.json",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/svelte": `file:${svelteTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          svelte: readCatalogVersion(catalog, "svelte"),
        },
        devDependencies: {
          "@sveltejs/vite-plugin-svelte": readCatalogVersion(
            catalog,
            "@sveltejs/vite-plugin-svelte",
          ),
          "svelte-check": readCatalogVersion(catalog, "svelte-check"),
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
      "minimumReleaseAgeExclude:",
      `  - ${JSON.stringify(`coaction@${readCatalogVersion(catalog, "coaction")}`)}`,
      "allowBuilds:",
      '  "@parcel/watcher": true',
      "  esbuild: true",
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "@cosystem/svelte": ${JSON.stringify(`file:${svelteTarball}`)}`,
      `  "@sveltejs/vite-plugin-svelte": ${JSON.stringify(readCatalogVersion(catalog, "@sveltejs/vite-plugin-svelte"))}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "svelte": ${JSON.stringify(readCatalogVersion(catalog, "svelte"))}`,
      `  "svelte-check": ${JSON.stringify(readCatalogVersion(catalog, "svelte-check"))}`,
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
          declarationMap: false,
          isolatedDeclarations: false,
          lib: ["DOM", "DOM.Iterable", "ES2023"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["svelte", "vite/client"],
        },
        include: ["src/**/*.ts", "src/**/*.svelte", "svelte.config.js", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDir, "svelte.config.js"),
    [
      'import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";',
      "",
      "export default {",
      "  preprocess: vitePreprocess(),",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDir, "vite.config.ts"),
    [
      'import { svelte } from "@sveltejs/vite-plugin-svelte";',
      'import { defineConfig } from "vite";',
      "",
      "export default defineConfig({",
      "  plugins: [svelte()],",
      "});",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDir, "index.html"),
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "    <title>CoSystem Svelte browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Svelte browser smoke">',
      "      <h1>Svelte browser smoke</h1>",
      '      <div id="app"></div>',
      "    </main>",
      '    <script type="module" src="/src/main.ts"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
  );
  await writeFile(join(consumerDir, "src/counter.ts"), createCounterSource());
  await writeFile(join(consumerDir, "src/App.svelte"), createAppSource());
  await writeFile(join(consumerDir, "src/main.ts"), createMainSource());
}

function createCounterSource() {
  return `import { createApp, defineModule } from "@cosystem/core";

export class BrowserCounter {
  count = 0;
  phase = "idle";

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): number {
    this.count += step;
    this.phase = "sync";
    return this.count;
  }

  async increaseLater(step = 1): Promise<number> {
    this.phase = "pending";
    await Promise.resolve();
    this.count += step;
    this.phase = "done";
    return this.count;
  }
}

defineModule(BrowserCounter, {
  actions: ["increase", "increaseLater"],
  computed: ["double"],
  name: "svelteBrowserCounter",
  state: ["count", "phase"],
});

export const app = createApp({
  providers: [BrowserCounter],
});
`;
}

function createAppSource() {
  return `<script lang="ts">
  import {
    getCoSystemApp,
    moduleStore,
    selectedModuleStore,
    selectorStore,
  } from "@cosystem/svelte";

  import { app, BrowserCounter } from "./counter";

  const counter = moduleStore(BrowserCounter, app);
  const count = selectedModuleStore(BrowserCounter, (module) => module.count, { app });
  const double = selectedModuleStore(BrowserCounter, (module) => module.double, { app });
  const phase = selectedModuleStore(BrowserCounter, (module) => module.phase, { app });
  const parity = selectorStore(
    (currentApp) => ({
      parity: currentApp.getModule(BrowserCounter).count % 2,
    }),
    {
      app,
      equals: (value, previous) => value.parity === previous.parity,
    },
  );
  const provided = String(getCoSystemApp() === app);
  let pending = false;

  async function increaseAsync(): Promise<void> {
    pending = true;

    try {
      await $counter.increaseLater(3);
    } finally {
      pending = false;
    }
  }
</script>

<section aria-label="Svelte adapter smoke">
  <dl>
    <div><dt>Status</dt><dd id="status">{pending ? "pending" : "ready"}</dd></div>
    <div><dt>Provided</dt><dd id="provided">{provided}</dd></div>
    <div><dt>Count</dt><dd id="count">{$count}</dd></div>
    <div><dt>Double</dt><dd id="double">{$double}</dd></div>
    <div><dt>Phase</dt><dd id="phase">{$phase}</dd></div>
    <div><dt>Parity</dt><dd id="parity">{$parity.parity}</dd></div>
  </dl>
  <button id="increase-two" type="button" onclick={() => $counter.increase(2)}>
    Increase by 2
  </button>
  <button id="increase-one" type="button" onclick={() => $counter.increase(1)}>
    Increase by 1
  </button>
  <button id="increase-async" type="button" onclick={increaseAsync}>Increase async</button>
</section>
`;
}

function createMainSource() {
  return `import { mount, unmount } from "svelte";
import { clearCoSystemApp, setCoSystemApp } from "@cosystem/svelte";
import type { App as CoSystemApp } from "@cosystem/core";

import App from "./App.svelte";
import { app, BrowserCounter } from "./counter";

type SmokeSnapshot = {
  readonly count: number;
  readonly double: number;
  readonly parity: string;
  readonly phase: string;
  readonly provided: string;
  readonly state: unknown;
  readonly status: string;
};

declare global {
  interface Window {
    __cosystemSvelteSmoke?: {
      readonly app: CoSystemApp;
      dispose(): Promise<void>;
      setByRunInAction(value: number): void;
      snapshot(): SmokeSnapshot;
    };
  }
}

const rootElement = document.querySelector("#app");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing Svelte root element.");
}

setCoSystemApp(app);

const component = mount(App, {
  target: rootElement,
});

window.__cosystemSvelteSmoke = {
  app,
  async dispose() {
    unmount(component);
    clearCoSystemApp();
    await app.dispose();
  },
  setByRunInAction(value) {
    const counter = app.getModule(BrowserCounter);

    app.runInAction(
      BrowserCounter,
      () => {
        counter.count = value;
        counter.phase = "manual";
      },
      {
        name: "browserManual",
      },
    );
  },
  snapshot() {
    return {
      count: app.getModule(BrowserCounter).count,
      double: app.getModule(BrowserCounter).double,
      parity: readText("#parity"),
      phase: app.getModule(BrowserCounter).phase,
      provided: readText("#provided"),
      state: app.store.getPureState(),
      status: readText("#status"),
    };
  },
};

function readText(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}
`;
}

async function runSvelteBrowserSmoke(currentBrowser, url) {
  const page = await currentBrowser.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__cosystemSvelteSmoke !== undefined);

    await expectText(page, "#status", "ready");
    await expectText(page, "#provided", "true");
    await expectText(page, "#count", "0");
    await expectText(page, "#double", "0");
    await expectText(page, "#phase", "idle");
    await expectText(page, "#parity", "0");

    await clickButton(page, "Increase by 2");
    await expectText(page, "#count", "2");
    await expectText(page, "#double", "4");
    await expectText(page, "#phase", "sync");
    await expectText(page, "#parity", "0");

    await clickButton(page, "Increase by 1");
    await expectText(page, "#count", "3");
    await expectText(page, "#double", "6");
    await expectText(page, "#parity", "1");

    await clickButton(page, "Increase async");
    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "6");
    await expectText(page, "#double", "12");
    await expectText(page, "#phase", "done");
    await expectText(page, "#parity", "0");

    await page.evaluate(() => window.__cosystemSvelteSmoke?.setByRunInAction(10));
    await expectText(page, "#count", "10");
    await expectText(page, "#double", "20");
    await expectText(page, "#phase", "manual");

    const snapshot = await page.evaluate(() => window.__cosystemSvelteSmoke?.snapshot());

    expectJsonEqual(
      snapshot,
      {
        count: 10,
        double: 20,
        parity: "0",
        phase: "manual",
        provided: "true",
        state: {
          svelteBrowserCounter: {
            count: 10,
            phase: "manual",
          },
        },
        status: "ready",
      },
      "final browser snapshot",
    );

    await page.evaluate(() => window.__cosystemSvelteSmoke?.dispose());

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        [
          "Svelte browser smoke emitted browser errors.",
          ...consoleErrors.map((error) => `console: ${error}`),
          ...pageErrors.map((error) => `page: ${error}`),
        ].join("\n"),
      );
    }
  } finally {
    await page.close();
  }
}

async function expectText(page, selector, expected) {
  await page.waitForFunction(
    ({ expectedValue, targetSelector }) =>
      document.querySelector(targetSelector)?.textContent?.trim() === expectedValue,
    { expectedValue: expected, targetSelector: selector },
  );
}

async function clickButton(page, label) {
  await page.getByRole("button", { name: label }).click();
}

function expectJsonEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);

  if (actualJson !== expectedJson) {
    throw new Error(label + ": expected " + expectedJson + ", got " + actualJson);
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
        "Unable to launch Chromium for Svelte browser smoke.",
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

      const filePath = await resolveRequestPath(root, request.url ?? "/");
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

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
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
    throw new Error(`Missing built Svelte browser asset: ${path}`);
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
      maxBuffer: 1024 * 1024 * 20,
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
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next well-known browser path.
    }
  }

  return undefined;
}

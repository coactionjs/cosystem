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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-svelte-worker-browser-"));
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
  await run("pnpm", ["install", "--offline"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runSvelteWorkerBrowserSmoke(browser, server.url);

  console.log("Verified installed Svelte worker adapter browser DOM integration.");
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
        name: "cosystem-svelte-worker-browser-smoke",
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
          lib: ["DOM", "DOM.Iterable", "ES2023", "WebWorker"],
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
      "    <title>CoSystem Svelte worker browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Svelte worker browser smoke">',
      "      <h1>Svelte worker browser smoke</h1>",
      '      <div id="app"></div>',
      "    </main>",
      '    <script type="module" src="/src/main.ts"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
  );
  await writeFile(join(consumerDir, "src/App.svelte"), createAppSource());
  await writeFile(join(consumerDir, "src/counter.worker.ts"), createWorkerSource());
  await writeFile(join(consumerDir, "src/main.ts"), createMainSource());
}

function createAppSource() {
  return `<script lang="ts">
  import { workerModuleStore, workerSelectorStore } from "@cosystem/svelte";

  type SvelteWorkerCounterApi = {
    failAfterIncrease(step?: number): Promise<void>;
    increase(step?: number): Promise<number>;
    increaseLater(step?: number): Promise<number>;
    reset(): Promise<number>;
  };

  type SvelteWorkerState = {
    readonly svelteWorkerCounter: {
      readonly count: number;
      readonly phase: string;
    };
  };

  const counter = workerModuleStore<SvelteWorkerCounterApi>("svelteWorkerCounter");
  const count = workerSelectorStore(selectCount);
  const phase = workerSelectorStore(selectPhase);
  const stateVersion = workerSelectorStore((_state, currentClient) => currentClient.state.version);
  const parity = workerSelectorStore(
    (state) => ({
      parity: selectCount(state) % 2,
    }),
    {
      equals: (value, previous) => value.parity === previous.parity,
    },
  );
  let pending = false;
  let lastResult = "none";
  let lastError = "none";

  function selectCount(state: unknown): number {
    return (state as SvelteWorkerState).svelteWorkerCounter.count;
  }

  function selectPhase(state: unknown): string {
    return (state as SvelteWorkerState).svelteWorkerCounter.phase;
  }

  async function increaseBy(step: number): Promise<void> {
    pending = true;
    lastError = "none";

    try {
      lastResult = String(await $counter.increase(step));
    } finally {
      pending = false;
    }
  }

  async function increaseAsync(): Promise<void> {
    pending = true;
    lastError = "none";

    try {
      lastResult = String(await $counter.increaseLater(3));
    } finally {
      pending = false;
    }
  }

  async function failAfterIncrease(): Promise<void> {
    pending = true;
    lastResult = "none";

    try {
      await $counter.failAfterIncrease(4);
      lastError = "missing rejection";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      pending = false;
    }
  }

  async function reset(): Promise<void> {
    pending = true;
    lastError = "none";

    try {
      lastResult = String(await $counter.reset());
    } finally {
      pending = false;
    }
  }
</script>

<section aria-label="Svelte adapter smoke">
  <dl>
    <div><dt>Status</dt><dd id="status">{pending ? "pending" : "ready"}</dd></div>
    <div><dt>Count</dt><dd id="count">{$count}</dd></div>
    <div><dt>Phase</dt><dd id="phase">{$phase}</dd></div>
    <div><dt>State version</dt><dd id="state-version">{$stateVersion}</dd></div>
    <div><dt>Last result</dt><dd id="last-result">{lastResult}</dd></div>
    <div><dt>Last error</dt><dd id="last-error">{lastError}</dd></div>
    <div><dt>Parity</dt><dd id="parity">{$parity.parity}</dd></div>
  </dl>
  <button id="increase-two" type="button" onclick={() => increaseBy(2)}>
    Increase by 2
  </button>
  <button id="increase-one" type="button" onclick={() => increaseBy(1)}>
    Increase by 1
  </button>
  <button id="increase-async" type="button" onclick={increaseAsync}>Increase async</button>
  <button id="fail-after-increase" type="button" onclick={failAfterIncrease}>
    Fail after increase
  </button>
  <button id="reset" type="button" onclick={reset}>Reset</button>
</section>
`;
}

function createMainSource() {
  return `import { mount, unmount } from "svelte";
import {
  createPostMessageWorkerTransport,
  createWorkerClient,
  type WorkerClient,
} from "@cosystem/core";
import { clearWorkerClient, setWorkerClient } from "@cosystem/svelte";

import App from "./App.svelte";

type SmokeSnapshot = {
  readonly count: number;
  readonly lastError: string;
  readonly lastResult: string;
  readonly parity: string;
  readonly phase: string;
  readonly state: unknown;
  readonly stateVersion: number;
  readonly status: string;
};

declare global {
  interface Window {
    __cosystemSvelteWorkerSmoke?: {
      readonly client: WorkerClient;
      readonly ready: Promise<void>;
      dispose(): void;
      snapshot(): SmokeSnapshot;
    };
  }
}

const rootElement = document.querySelector("#app");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing Svelte root element.");
}

const root = rootElement;
const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
let component: ReturnType<typeof mount> | undefined;
const ready = start();

window.__cosystemSvelteWorkerSmoke = {
  client,
  dispose() {
    if (component !== undefined) {
      unmount(component);
    }

    clearWorkerClient();
    client.dispose();
    worker.terminate();
  },
  ready,
  snapshot() {
    return {
      count: Number(readText("#count")),
      lastError: readText("#last-error"),
      lastResult: readText("#last-result"),
      parity: readText("#parity"),
      phase: readText("#phase"),
      state: client.getState(),
      stateVersion: client.state.version,
      status: readText("#status"),
    };
  },
};

async function start(): Promise<void> {
  await client.ready;
  setWorkerClient(client);

  component = mount(App, {
    target: root,
  });
}

function readText(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}
`;
}

function createWorkerSource() {
  return `import {
  createPostMessageWorkerTransport,
  createWorkerApp,
  defineModule,
  type PostMessageEndpoint,
} from "@cosystem/core";

class SvelteWorkerCounter {
  count = 0;
  phase = "idle";

  increase(step = 1): number {
    this.count += step;
    this.phase = "sync";
    return this.count;
  }

  async increaseLater(step = 1): Promise<number> {
    this.phase = "pending";
    await delay();
    this.count += step;
    this.phase = "done";
    return this.count;
  }

  async failAfterIncrease(step = 1): Promise<void> {
    this.phase = "failing";
    await delay();
    this.count += step;
    this.phase = "failed";
    throw new Error(\`failed at \${this.count}\`);
  }

  reset(): number {
    this.count = 0;
    this.phase = "reset";
    return this.count;
  }
}

defineModule(SvelteWorkerCounter, {
  actions: ["failAfterIncrease", "increase", "increaseLater", "reset"],
  name: "svelteWorkerCounter",
  state: ["count", "phase"],
});

const host = createWorkerApp({
  providers: [SvelteWorkerCounter],
  sync: "patch",
  transport: createPostMessageWorkerTransport(globalThis as unknown as PostMessageEndpoint),
});

void host.ready;

async function delay(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
  });
}
`;
}

async function runSvelteWorkerBrowserSmoke(currentBrowser, url) {
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
    await page.waitForFunction(() => window.__cosystemSvelteWorkerSmoke !== undefined);
    await page.evaluate(() => window.__cosystemSvelteWorkerSmoke?.ready);

    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "0");
    await expectText(page, "#phase", "idle");
    await expectText(page, "#parity", "0");
    await expectText(page, "#last-result", "none");
    await expectText(page, "#last-error", "none");

    await clickButton(page, "Increase by 2");
    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "2");
    await expectText(page, "#phase", "sync");
    await expectText(page, "#last-result", "2");
    await expectText(page, "#parity", "0");

    await clickButton(page, "Increase by 1");
    await expectText(page, "#count", "3");
    await expectText(page, "#last-result", "3");
    await expectText(page, "#parity", "1");

    await clickButton(page, "Increase async");
    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "6");
    await expectText(page, "#phase", "done");
    await expectText(page, "#last-result", "6");
    await expectText(page, "#parity", "0");

    await clickButton(page, "Fail after increase");
    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "10");
    await expectText(page, "#phase", "failed");
    await expectText(page, "#last-error", "Remote worker error: failed at 10");
    await expectText(page, "#parity", "0");

    await clickButton(page, "Reset");
    await expectText(page, "#count", "0");
    await expectText(page, "#phase", "reset");
    await expectText(page, "#last-result", "0");

    const snapshot = await page.evaluate(() => window.__cosystemSvelteWorkerSmoke?.snapshot());

    expectJsonEqual(
      snapshot,
      {
        count: 0,
        lastError: "none",
        lastResult: "0",
        parity: "0",
        phase: "reset",
        state: {
          svelteWorkerCounter: {
            count: 0,
            phase: "reset",
          },
        },
        stateVersion: snapshot?.stateVersion,
        status: "ready",
      },
      "final Svelte worker browser snapshot",
    );
    assertAtLeast(snapshot?.stateVersion ?? 0, 5, "worker state version");

    await page.evaluate(() => window.__cosystemSvelteWorkerSmoke?.dispose());

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        [
          "Svelte worker browser smoke emitted browser errors.",
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

function assertAtLeast(actual, expected, label) {
  if (actual < expected) {
    throw new Error(label + ": expected at least " + String(expected) + ", got " + String(actual));
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
        "Unable to launch Chromium for Svelte worker browser smoke.",
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
    throw new Error(`Missing built Svelte worker browser asset: ${path}`);
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

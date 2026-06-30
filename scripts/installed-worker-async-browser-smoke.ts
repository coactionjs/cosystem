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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-worker-async-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject(coreTarball, catalog);
  await run("pnpm", ["install", "--offline", "--no-frozen-lockfile"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runWorkerAsyncSmoke(browser, server.url);

  console.log("Verified installed worker async action state synchronization.");
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

async function writeConsumerProject(coreTarball, catalog) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-worker-async-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
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
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
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
        include: ["src/**/*.ts"],
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
      "    <title>CoSystem worker async browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Worker async smoke">',
      "      <h1>Worker async browser smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Count</dt><dd id="count">0</dd></div>',
      '        <div><dt>State version</dt><dd id="state-version">0</dd></div>',
      '        <div><dt>Last result</dt><dd id="last-result">none</dd></div>',
      '        <div><dt>Last error</dt><dd id="last-error">none</dd></div>',
      '        <div><dt>Selected at resolution</dt><dd id="selected-at-resolution">none</dd></div>',
      '        <div><dt>Selected at rejection</dt><dd id="selected-at-rejection">none</dd></div>',
      "      </dl>",
      '      <button type="button" id="increase-later">Increase later</button>',
      '      <button type="button" id="fail-after-increase">Fail after increase</button>',
      '      <button type="button" id="reset">Reset</button>',
      "    </main>",
      '    <script type="module" src="/src/main.ts"></script>',
      "  </body>",
      "</html>",
      "",
    ].join("\n"),
  );
  await writeFile(join(consumerDir, "src/main.ts"), createBrowserSource());
  await writeFile(join(consumerDir, "src/counter.worker.ts"), createWorkerSource());
}

function createBrowserSource() {
  return `import {
  createPostMessageWorkerTransport,
  createWorkerClient,
  type AsyncMethodProxy,
  type WorkerStateMessage,
} from "@cosystem/core";

interface AsyncCounterApi {
  failAfterIncrease(step?: number): Promise<void>;
  increaseLater(step?: number): Promise<number>;
  reset(): Promise<number>;
}

interface AsyncCounterState {
  readonly asyncCounter: {
    readonly count: number;
  };
}

interface WorkerAsyncSnapshot {
  readonly count: number;
  readonly lastError: string | null;
  readonly lastResult: number | null;
  readonly messageVersions: readonly number[];
  readonly selectedAtRejection: number | null;
  readonly selectedAtResolution: number | null;
  readonly stateVersion: number;
}

declare global {
  interface Window {
    __cosystemWorkerAsyncSmoke?: {
      readonly ready: Promise<void>;
      failAfterIncrease(step?: number): Promise<WorkerAsyncSnapshot>;
      increaseLater(step?: number): Promise<WorkerAsyncSnapshot>;
      read(): WorkerAsyncSnapshot;
      reset(): Promise<WorkerAsyncSnapshot>;
    };
  }
}

const root = document.querySelector("main");

if (root === null) {
  throw new Error("Missing smoke root.");
}

const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
const counter: AsyncMethodProxy<AsyncCounterApi> = client.module<AsyncCounterApi>("asyncCounter");
const messageVersions: number[] = [];
const selectCount = (state: unknown): number => (state as AsyncCounterState).asyncCounter.count;

let count = 0;
let lastError: string | null = null;
let lastResult: number | null = null;
let ready = false;
let selectedAtRejection: number | null = null;
let selectedAtResolution: number | null = null;
let unsubscribe = (): void => {};

client.subscribe((message: WorkerStateMessage) => {
  messageVersions.push(message.version);
});

const readyPromise = start();

window.__cosystemWorkerAsyncSmoke = {
  ready: readyPromise,
  failAfterIncrease,
  increaseLater,
  read,
  reset,
};

getElement<HTMLButtonElement>("increase-later").addEventListener("click", () => {
  void runButtonAction(() => increaseLater(1));
});
getElement<HTMLButtonElement>("fail-after-increase").addEventListener("click", () => {
  void runButtonAction(() => failAfterIncrease(1));
});
getElement<HTMLButtonElement>("reset").addEventListener("click", () => {
  void runButtonAction(reset);
});
window.addEventListener("beforeunload", () => {
  unsubscribe();
  client.dispose();
  worker.terminate();
});

render();

async function start(): Promise<void> {
  await client.ready;
  ready = true;
  count = client.select(selectCount);
  unsubscribe = client.watch(selectCount, (value) => {
    count = value;
    render();
  });
  render();
}

async function increaseLater(step = 1): Promise<WorkerAsyncSnapshot> {
  await readyPromise;
  clearLastCall();

  const value = await counter.increaseLater(step);

  selectedAtResolution = client.select(selectCount);
  count = selectedAtResolution;
  lastResult = value;
  render();
  return read();
}

async function failAfterIncrease(step = 1): Promise<WorkerAsyncSnapshot> {
  await readyPromise;
  clearLastCall();

  try {
    await counter.failAfterIncrease(step);
  } catch (error) {
    selectedAtRejection = client.select(selectCount);
    count = selectedAtRejection;
    lastError = error instanceof Error ? error.message : String(error);
    render();
    return read();
  }

  throw new Error("Expected failAfterIncrease() to reject.");
}

async function reset(): Promise<WorkerAsyncSnapshot> {
  await readyPromise;
  clearLastCall();

  const value = await counter.reset();

  selectedAtResolution = client.select(selectCount);
  count = selectedAtResolution;
  lastResult = value;
  render();
  return read();
}

function clearLastCall(): void {
  lastError = null;
  lastResult = null;
  selectedAtRejection = null;
  selectedAtResolution = null;
  render();
}

function read(): WorkerAsyncSnapshot {
  return {
    count,
    lastError,
    lastResult,
    messageVersions: [...messageVersions],
    selectedAtRejection,
    selectedAtResolution,
    stateVersion: client.state.version,
  };
}

async function runButtonAction(action: () => Promise<WorkerAsyncSnapshot>): Promise<void> {
  await action();
}

function render(): void {
  getElement("status").textContent = ready ? "ready" : "connecting";
  getElement("count").textContent = String(count);
  getElement("state-version").textContent = String(client.state.version);
  getElement("last-result").textContent = lastResult === null ? "none" : String(lastResult);
  getElement("last-error").textContent = lastError ?? "none";
  getElement("selected-at-resolution").textContent =
    selectedAtResolution === null ? "none" : String(selectedAtResolution);
  getElement("selected-at-rejection").textContent =
    selectedAtRejection === null ? "none" : String(selectedAtRejection);
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

function createWorkerSource() {
  return `import {
  createPostMessageWorkerTransport,
  createWorkerApp,
  defineModule,
  type PostMessageEndpoint,
} from "@cosystem/core";

class AsyncCounter {
  count = 0;

  async increaseLater(step = 1): Promise<number> {
    await delay();
    this.count += step;
    return this.count;
  }

  async failAfterIncrease(step = 1): Promise<void> {
    await delay();
    this.count += step;
    throw new Error(\`failed at \${this.count}\`);
  }

  reset(): number {
    this.count = 0;
    return this.count;
  }
}

defineModule(AsyncCounter, {
  actions: ["failAfterIncrease", "increaseLater", "reset"],
  name: "asyncCounter",
  state: ["count"],
});

const host = createWorkerApp({
  providers: [AsyncCounter],
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

async function runWorkerAsyncSmoke(browserInstance, url) {
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
    await page.evaluate(() => window.__cosystemWorkerAsyncSmoke?.ready);
    await expectText(page, "h1", "Worker async browser smoke");
    await expectStat(page, "Status", "ready");
    await expectStat(page, "Count", "0");

    const afterResolve = await callSmoke(page, "increaseLater", 3);

    expectSnapshotValue(afterResolve.count, 3, "count after resolved async worker action");
    expectSnapshotValue(afterResolve.lastResult, 3, "result after resolved async worker action");
    expectSnapshotValue(
      afterResolve.selectedAtResolution,
      3,
      "selected count at async worker resolution",
    );
    expectIncreasingVersion(afterResolve.messageVersions, "resolved async worker action versions");
    await expectStat(page, "Count", "3");
    await expectStat(page, "Last result", "3");
    await expectStat(page, "Selected at resolution", "3");

    const afterReject = await callSmoke(page, "failAfterIncrease", 2);

    expectSnapshotValue(afterReject.count, 5, "count after rejected async worker action");
    expectSnapshotValue(
      afterReject.selectedAtRejection,
      5,
      "selected count at async worker rejection",
    );
    if (afterReject.lastError !== "Remote worker error: failed at 5") {
      throw new Error(`Unexpected async worker rejection: ${afterReject.lastError}`);
    }
    expectIncreasingVersion(afterReject.messageVersions, "rejected async worker action versions");
    await expectStat(page, "Count", "5");
    await expectStat(page, "Last error", "Remote worker error: failed at 5");
    await expectStat(page, "Selected at rejection", "5");

    const afterReset = await callSmoke(page, "reset");

    expectSnapshotValue(afterReset.count, 0, "count after async worker reset");
    expectSnapshotValue(afterReset.selectedAtResolution, 0, "selected count after reset");
    await expectStat(page, "Count", "0");

    if (errors.length > 0) {
      throw new Error(`Installed worker async smoke emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
}

async function callSmoke(page, method, ...args) {
  return await page.evaluate(
    ({ callArgs, methodName }) => {
      const smoke = window.__cosystemWorkerAsyncSmoke;

      if (smoke === undefined) {
        throw new Error("Worker async smoke API was not registered.");
      }

      const action = smoke[methodName];

      if (typeof action !== "function") {
        throw new Error(`Worker async smoke method ${methodName} is missing.`);
      }

      return action(...callArgs);
    },
    { callArgs: args, methodName: method },
  );
}

function expectSnapshotValue(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${expected}, got ${actual}.`);
  }
}

function expectIncreasingVersion(versions, label) {
  if (versions.length === 0) {
    throw new Error(`${label} must contain at least one state message.`);
  }

  const sorted = versions.toSorted((left, right) => left - right);

  if (versions.some((version, index) => version !== sorted[index])) {
    throw new Error(`${label} must be ordered: ${JSON.stringify(versions)}.`);
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
        "Unable to launch Chromium for installed worker async browser smoke.",
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
    throw new Error(`Missing built worker async smoke asset: ${path}`);
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

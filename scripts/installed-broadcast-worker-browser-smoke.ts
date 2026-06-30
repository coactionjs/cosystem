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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-broadcast-worker-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject(coreTarball, catalog);
  await run("pnpm", ["install", "--offline"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runBroadcastWorkerSmoke(browser, server.url);

  console.log("Verified installed broadcast worker browser transport.");
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
        name: "cosystem-broadcast-worker-browser-smoke",
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
      "    <title>CoSystem broadcast worker browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Broadcast worker smoke">',
      "      <h1>Broadcast worker browser smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Client one count</dt><dd id="client-one-count">0</dd></div>',
      '        <div><dt>Client two count</dt><dd id="client-two-count">0</dd></div>',
      '        <div><dt>Client one version</dt><dd id="client-one-version">0</dd></div>',
      '        <div><dt>Client two version</dt><dd id="client-two-version">0</dd></div>',
      '        <div><dt>Client one watches</dt><dd id="client-one-watches">[]</dd></div>',
      '        <div><dt>Client two watches</dt><dd id="client-two-watches">[]</dd></div>',
      "      </dl>",
      '      <button type="button" id="increase-one">Increase from client one</button>',
      '      <button type="button" id="increase-two">Increase from client two</button>',
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
  return `import {
  createBroadcastWorkerTransport,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
  type WorkerAppHost,
  type WorkerClient,
} from "@cosystem/core";

interface BroadcastCounterApi {
  increase(step?: number): number;
  reset(): number;
}

interface BroadcastCounterState {
  readonly broadcastCounter: {
    readonly count: number;
  };
}

type BroadcastSnapshot = {
  readonly clientOneCount: number;
  readonly clientOneVersion: number;
  readonly clientOneWatches: readonly number[];
  readonly clientTwoCount: number;
  readonly clientTwoVersion: number;
  readonly clientTwoWatches: readonly number[];
};

declare global {
  interface Window {
    __cosystemBroadcastWorkerSmoke?: {
      readonly ready: Promise<void>;
      increaseFromClientOne(step?: number): Promise<BroadcastSnapshot>;
      increaseFromClientTwo(step?: number): Promise<BroadcastSnapshot>;
      read(): BroadcastSnapshot;
      reset(): Promise<BroadcastSnapshot>;
    };
  }
}

class BroadcastCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }

  reset(): number {
    this.count = 0;
    return this.count;
  }
}

defineModule(BroadcastCounter, {
  actions: ["increase", "reset"],
  name: "broadcastCounter",
  state: ["count"],
});

const channelName = \`cosystem-broadcast-worker-browser-smoke-\${crypto.randomUUID()}\`;
const hostChannel = new BroadcastChannel(channelName);
const clientOneChannel = new BroadcastChannel(channelName);
const clientTwoChannel = new BroadcastChannel(channelName);
const clientOne = createBroadcastClient(clientOneChannel, "client:one");
const clientTwo = createBroadcastClient(clientTwoChannel, "client:two");
const host = createWorkerApp({
  providers: [BroadcastCounter],
  sync: "patch",
  transport: createBroadcastWorkerTransport(hostChannel, {
    peerId: "host",
  }),
});
const clientOneCounter: AsyncMethodProxy<BroadcastCounterApi> =
  clientOne.module<BroadcastCounterApi>("broadcastCounter");
const clientTwoCounter: AsyncMethodProxy<BroadcastCounterApi> =
  clientTwo.module<BroadcastCounterApi>("broadcastCounter");
const clientOneWatches: number[] = [];
const clientTwoWatches: number[] = [];
const selectCount = (state: unknown): number => (state as BroadcastCounterState).broadcastCounter.count;
let unsubscribeClientOne = (): void => {};
let unsubscribeClientTwo = (): void => {};

const ready = start();

window.__cosystemBroadcastWorkerSmoke = {
  ready,
  increaseFromClientOne,
  increaseFromClientTwo,
  read,
  reset,
};

getElement<HTMLButtonElement>("increase-one").addEventListener("click", () => {
  void runButtonAction(() => increaseFromClientOne(1));
});
getElement<HTMLButtonElement>("increase-two").addEventListener("click", () => {
  void runButtonAction(() => increaseFromClientTwo(1));
});
window.addEventListener("beforeunload", () => {
  void dispose();
});

render("starting");

async function start(): Promise<void> {
  await Promise.all([clientOne.ready, clientTwo.ready, host.ready]);

  unsubscribeClientOne = clientOne.watch(selectCount, (value) => {
    clientOneWatches.push(value);
    render("ready");
  });
  unsubscribeClientTwo = clientTwo.watch(selectCount, (value) => {
    clientTwoWatches.push(value);
    render("ready");
  });
  render("ready");
}

async function increaseFromClientOne(step = 1): Promise<BroadcastSnapshot> {
  await ready;
  const result = await clientOneCounter.increase(step);
  await waitForBothClients(result);
  render("ready");
  return read();
}

async function increaseFromClientTwo(step = 1): Promise<BroadcastSnapshot> {
  await ready;
  const result = await clientTwoCounter.increase(step);
  await waitForBothClients(result);
  render("ready");
  return read();
}

async function reset(): Promise<BroadcastSnapshot> {
  await ready;
  const result = await clientOneCounter.reset();
  await waitForBothClients(result);
  render("ready");
  return read();
}

function read(): BroadcastSnapshot {
  return {
    clientOneCount: clientOne.select(selectCount),
    clientOneVersion: clientOne.state.version,
    clientOneWatches: [...clientOneWatches],
    clientTwoCount: clientTwo.select(selectCount),
    clientTwoVersion: clientTwo.state.version,
    clientTwoWatches: [...clientTwoWatches],
  };
}

async function waitForBothClients(expected: number): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const snapshot = read();

    if (snapshot.clientOneCount === expected && snapshot.clientTwoCount === expected) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(\`Timed out waiting for broadcast clients to reach \${expected}.\`);
}

async function runButtonAction(action: () => Promise<BroadcastSnapshot>): Promise<void> {
  await action();
}

async function dispose(): Promise<void> {
  unsubscribeClientOne();
  unsubscribeClientTwo();
  clientOne.dispose();
  clientTwo.dispose();
  await host.dispose();
  hostChannel.close();
  clientOneChannel.close();
  clientTwoChannel.close();
}

function render(status: string): void {
  const snapshot = clientOne.state.version === 0 || clientTwo.state.version === 0 ? undefined : read();

  getElement("status").textContent = status;
  getElement("client-one-count").textContent = String(snapshot?.clientOneCount ?? 0);
  getElement("client-two-count").textContent = String(snapshot?.clientTwoCount ?? 0);
  getElement("client-one-version").textContent = String(snapshot?.clientOneVersion ?? 0);
  getElement("client-two-version").textContent = String(snapshot?.clientTwoVersion ?? 0);
  getElement("client-one-watches").textContent = JSON.stringify(snapshot?.clientOneWatches ?? []);
  getElement("client-two-watches").textContent = JSON.stringify(snapshot?.clientTwoWatches ?? []);
}

function createBroadcastClient(channel: BroadcastChannel, peerId: string): WorkerClient {
  return createWorkerClient({
    transport: createBroadcastWorkerTransport(channel, {
      peerId,
      targetPeerId: "host",
    }),
  });
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

async function runBroadcastWorkerSmoke(browserInstance, url) {
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
    await page.evaluate(() => window.__cosystemBroadcastWorkerSmoke?.ready);
    await expectText(page, "h1", "Broadcast worker browser smoke");
    await expectStat(page, "Status", "ready");

    const initial = await readSmokeSnapshot(page);
    assertSnapshot(initial, {
      clientOneCount: 0,
      clientOneVersion: 0,
      clientTwoCount: 0,
      clientTwoVersion: 0,
    });

    const afterClientOne = await callSmoke(page, "increaseFromClientOne", 2);

    assertSnapshot(afterClientOne, {
      clientOneCount: 2,
      clientTwoCount: 2,
    });
    assertAtLeast(afterClientOne.clientOneVersion, 1, "client one version after first action");
    assertAtLeast(afterClientOne.clientTwoVersion, 1, "client two version after first action");
    assertIncludes(afterClientOne.clientOneWatches, 2, "client one watch values");
    assertIncludes(afterClientOne.clientTwoWatches, 2, "client two watch values");
    await expectStat(page, "Client one count", "2");
    await expectStat(page, "Client two count", "2");

    const afterClientTwo = await callSmoke(page, "increaseFromClientTwo", 5);

    assertSnapshot(afterClientTwo, {
      clientOneCount: 7,
      clientTwoCount: 7,
    });
    assertAtLeast(afterClientTwo.clientOneVersion, 2, "client one version after second action");
    assertAtLeast(afterClientTwo.clientTwoVersion, 2, "client two version after second action");
    assertIncludes(afterClientTwo.clientOneWatches, 7, "client one watch values");
    assertIncludes(afterClientTwo.clientTwoWatches, 7, "client two watch values");
    await expectStat(page, "Client one count", "7");
    await expectStat(page, "Client two count", "7");

    const afterReset = await callSmoke(page, "reset");

    assertSnapshot(afterReset, {
      clientOneCount: 0,
      clientTwoCount: 0,
    });
    assertIncludes(afterReset.clientOneWatches, 0, "client one watch values after reset");
    assertIncludes(afterReset.clientTwoWatches, 0, "client two watch values after reset");
    await expectStat(page, "Client one count", "0");
    await expectStat(page, "Client two count", "0");

    if (errors.length > 0) {
      throw new Error(
        `Installed broadcast worker smoke emitted browser errors:\n${errors.join("\n")}`,
      );
    }
  } finally {
    await context.close();
  }
}

async function readSmokeSnapshot(page) {
  return await page.evaluate(() => {
    const smoke = window.__cosystemBroadcastWorkerSmoke;

    if (smoke === undefined) {
      throw new Error("Broadcast worker smoke API was not registered.");
    }

    return smoke.read();
  });
}

async function callSmoke(page, method, ...args) {
  return await page.evaluate(
    async ({ callArgs, methodName }) => {
      const smoke = window.__cosystemBroadcastWorkerSmoke;

      if (smoke === undefined) {
        throw new Error("Broadcast worker smoke API was not registered.");
      }

      const action = smoke[methodName];

      if (typeof action !== "function") {
        throw new Error(`Broadcast worker smoke method ${methodName} is missing.`);
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
        "Unable to launch Chromium for installed broadcast worker browser smoke.",
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
    throw new Error(`Missing built broadcast worker smoke asset: ${path}`);
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

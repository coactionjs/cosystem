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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-solid-worker-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const solidTarball = await packPackage("@cosystem/solid");

  await writeConsumerProject({ catalog, coreTarball, solidTarball });
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runSolidWorkerBrowserSmoke(browser, server.url);

  console.log("Verified installed Solid worker adapter browser DOM integration.");
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

async function writeConsumerProject({ catalog, coreTarball, solidTarball }) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-solid-worker-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/solid": `file:${solidTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          "solid-js": readCatalogVersion(catalog, "solid-js"),
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
      `  "@cosystem/solid": ${JSON.stringify(`file:${solidTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "solid-js": ${JSON.stringify(readCatalogVersion(catalog, "solid-js"))}`,
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
          lib: ["DOM", "DOM.Iterable", "ES2023", "WebWorker"],
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
      "    <title>CoSystem Solid worker browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Solid worker browser smoke">',
      "      <h1>Solid worker browser smoke</h1>",
      '      <div id="root"></div>',
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
  type WorkerClient,
} from "@cosystem/core";
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/solid";
import { createRenderEffect, createSignal } from "solid-js";
import { render } from "solid-js/web";

type SolidWorkerCounterApi = {
  failAfterIncrease(step?: number): Promise<void>;
  increase(step?: number): Promise<number>;
  increaseLater(step?: number): Promise<number>;
  reset(): Promise<number>;
};

type SolidWorkerState = {
  readonly solidWorkerCounter: {
    readonly count: number;
    readonly phase: string;
  };
};

type SmokeSnapshot = {
  readonly count: number;
  readonly lastError: string;
  readonly lastResult: string;
  readonly parity: string;
  readonly parityRenders: number;
  readonly phase: string;
  readonly state: unknown;
  readonly stateVersion: number;
  readonly status: string;
};

declare global {
  interface Window {
    __cosystemSolidWorkerSmoke?: {
      readonly client: WorkerClient;
      readonly ready: Promise<void>;
      dispose(): void;
      snapshot(): SmokeSnapshot;
    };
  }
}

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Missing Solid root element.");
}

const root = rootElement;
const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
let disposeSolid: (() => void) | undefined;
const ready = start();

window.__cosystemSolidWorkerSmoke = {
  client,
  dispose() {
    disposeSolid?.();
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
      parityRenders: Number(readText("#parity-renders")),
      phase: readText("#phase"),
      state: client.getState(),
      stateVersion: client.state.version,
      status: readText("#status"),
    };
  },
};

async function start(): Promise<void> {
  await client.ready;

  disposeSolid = render(
    () =>
      WorkerClientProvider({
        client,
        get children() {
          return [CounterView(), ParityView()];
        },
      }),
    root,
  );
}

function CounterView(): HTMLElement {
  const counter = useWorkerModule<SolidWorkerCounterApi>("solidWorkerCounter");
  const count = useWorkerSelector(selectCount);
  const phase = useWorkerSelector(selectPhase);
  const stateVersion = useWorkerSelector((_state, currentClient) => currentClient.state.version);
  const [pending, setPending] = createSignal(false);
  const [lastResult, setLastResult] = createSignal("none");
  const [lastError, setLastError] = createSignal("none");
  const section = document.createElement("section");
  const stats = document.createElement("dl");
  const status = createStat("Status", "status");
  const countStat = createStat("Count", "count");
  const phaseStat = createStat("Phase", "phase");
  const versionStat = createStat("State version", "state-version");
  const resultStat = createStat("Last result", "last-result");
  const errorStat = createStat("Last error", "last-error");
  const increaseTwo = createButton("increase-two", "Increase by 2", async () => {
      setPending(true);
      setLastError("none");
      setLastResult(String(await counter.increase(2)));
      setPending(false);
    });
  const increaseOne = createButton("increase-one", "Increase by 1", async () => {
      setPending(true);
      setLastError("none");
      setLastResult(String(await counter.increase(1)));
      setPending(false);
    });
  const increaseAsync = createButton("increase-async", "Increase async", async () => {
      setPending(true);
      setLastError("none");
      setLastResult(String(await counter.increaseLater(3)));
      setPending(false);
    });
  const failAfterIncrease = createButton("fail-after-increase", "Fail after increase", async () => {
      setPending(true);
      setLastResult("none");

      try {
        await counter.failAfterIncrease(4);
        setLastError("missing rejection");
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    });
  const reset = createButton("reset", "Reset", async () => {
      setPending(true);
      setLastError("none");
      setLastResult(String(await counter.reset()));
      setPending(false);
    });

  section.setAttribute("aria-label", "Counter");
  stats.append(
    status.row,
    countStat.row,
    phaseStat.row,
    versionStat.row,
    resultStat.row,
    errorStat.row,
  );
  section.append(stats, increaseTwo, increaseOne, increaseAsync, failAfterIncrease, reset);

  createRenderEffect(() => {
    status.value.textContent = pending() ? "pending" : "ready";
    countStat.value.textContent = String(count());
    phaseStat.value.textContent = phase();
    versionStat.value.textContent = String(stateVersion());
    resultStat.value.textContent = lastResult();
    errorStat.value.textContent = lastError();
  });

  return section;
}

function ParityView(): HTMLElement {
  const selected = useWorkerSelector(
    (state) => ({
      parity: selectCount(state) % 2,
    }),
    {
      equals: (value, previous) => value.parity === previous.parity,
    },
  );
  const section = document.createElement("section");
  const parity = document.createElement("span");
  const renders = document.createElement("span");
  let renderCount = 0;

  section.setAttribute("aria-label", "Parity");
  parity.id = "parity";
  renders.id = "parity-renders";
  section.append(parity, renders);

  createRenderEffect(() => {
    parity.textContent = String(selected().parity);
    renderCount += 1;
    renders.textContent = String(renderCount);
  });

  return section;
}

function selectCount(state: unknown): number {
  return (state as SolidWorkerState).solidWorkerCounter.count;
}

function selectPhase(state: unknown): string {
  return (state as SolidWorkerState).solidWorkerCounter.phase;
}

function createStat(label: string, id: string): {
  readonly row: HTMLDivElement;
  readonly value: HTMLElement;
} {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const value = document.createElement("dd");

  term.textContent = label;
  value.id = id;
  row.append(term, value);

  return { row, value };
}

function createButton(id: string, label: string, action: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement("button");

  button.id = id;
  button.textContent = label;
  button.type = "button";
  button.addEventListener("click", () => {
    void action();
  });

  return button;
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

class SolidWorkerCounter {
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

defineModule(SolidWorkerCounter, {
  actions: ["failAfterIncrease", "increase", "increaseLater", "reset"],
  name: "solidWorkerCounter",
  state: ["count", "phase"],
});

const host = createWorkerApp({
  providers: [SolidWorkerCounter],
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

async function runSolidWorkerBrowserSmoke(currentBrowser, url) {
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
    await page.evaluate(() => window.__cosystemSolidWorkerSmoke?.ready);

    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "0");
    await expectText(page, "#phase", "idle");
    await expectText(page, "#parity", "0");

    const initialParityRenders = await getParityRenders(page);

    await clickButton(page, "Increase by 2");
    await expectText(page, "#status", "ready");
    await expectText(page, "#count", "2");
    await expectText(page, "#phase", "sync");
    await expectText(page, "#last-result", "2");
    await expectText(page, "#parity", "0");
    expectEqual(
      await getParityRenders(page),
      initialParityRenders,
      "selector equality skips same-parity worker render",
    );

    await clickButton(page, "Increase by 1");
    await expectText(page, "#count", "3");
    await expectText(page, "#last-result", "3");
    await expectText(page, "#parity", "1");
    assertAtLeast(
      await getParityRenders(page),
      initialParityRenders + 1,
      "selector equality renders changed worker parity",
    );

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

    const snapshot = await page.evaluate(() => window.__cosystemSolidWorkerSmoke?.snapshot());

    expectJsonEqual(
      snapshot,
      {
        count: 0,
        lastError: "none",
        lastResult: "0",
        parity: "0",
        parityRenders: snapshot?.parityRenders,
        phase: "reset",
        state: {
          solidWorkerCounter: {
            count: 0,
            phase: "reset",
          },
        },
        stateVersion: snapshot?.stateVersion,
        status: "ready",
      },
      "final Solid worker browser snapshot",
    );
    assertAtLeast(snapshot?.stateVersion ?? 0, 5, "worker state version");

    await page.evaluate(() => window.__cosystemSolidWorkerSmoke?.dispose());

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        [
          "Solid worker browser smoke emitted browser errors.",
          ...consoleErrors.map((error) => `console: ${error}`),
          ...pageErrors.map((error) => `page: ${error}`),
        ].join("\n"),
      );
    }
  } finally {
    await page.close();
  }
}

async function getParityRenders(page) {
  return Number(await page.locator("#parity-renders").textContent());
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

function expectEqual(actual, expected, label) {
  if (!Object.is(actual, expected)) {
    throw new Error(label + ": expected " + String(expected) + ", got " + String(actual));
  }
}

function assertAtLeast(actual, expected, label) {
  if (actual < expected) {
    throw new Error(label + ": expected at least " + String(expected) + ", got " + String(actual));
  }
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
        "Unable to launch Chromium for Solid worker browser smoke.",
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
    throw new Error(`Missing built Solid worker browser asset: ${path}`);
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

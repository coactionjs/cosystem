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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-devtools-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const devtoolsTarball = await packPackage("@cosystem/devtools");

  await writeConsumerProject(coreTarball, devtoolsTarball, catalog);
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runDevtoolsSmoke(browser, server.url);

  console.log("Verified installed devtools plugin browser timeline events.");
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

async function writeConsumerProject(coreTarball, devtoolsTarball, catalog) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-devtools-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/devtools": `file:${devtoolsTarball}`,
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
      "minimumReleaseAgeExclude:",
      `  - ${JSON.stringify(`coaction@${readCatalogVersion(catalog, "coaction")}`)}`,
      "allowBuilds:",
      '  "@parcel/watcher": true',
      "  esbuild: true",
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "@cosystem/devtools": ${JSON.stringify(`file:${devtoolsTarball}`)}`,
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
      "    <title>CoSystem devtools browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Devtools smoke">',
      "      <h1>Devtools browser smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Count</dt><dd id="count">0</dd></div>',
      '        <div><dt>Timeline count</dt><dd id="timeline-count">0</dd></div>',
      '        <div><dt>Last event</dt><dd id="last-event">none</dd></div>',
      '        <div><dt>Error count</dt><dd id="error-count">0</dd></div>',
      '        <div><dt>Subscriber count</dt><dd id="subscriber-count">0</dd></div>',
      '        <div><dt>Trimmed events</dt><dd id="trimmed-events">none</dd></div>',
      "      </dl>",
      '      <button type="button" id="increase">Increase</button>',
      '      <button type="button" id="fail">Fail</button>',
      '      <button type="button" id="trim">Trim timeline</button>',
      '      <button type="button" id="clear">Clear timeline</button>',
      '      <button type="button" id="unsubscribe">Unsubscribe</button>',
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

type AppState = {
  readonly devtoolsBrowserCounter?: {
    readonly count: number;
  };
};

type BrowserDevtoolsTimelineEvent = ReturnType<
  ReturnType<typeof createDevtoolsPlugin>["getTimeline"]
>[number];

type SmokeSnapshot = {
  readonly actionMethods: readonly string[];
  readonly count: number;
  readonly errorMessages: readonly string[];
  readonly errorPhases: readonly string[];
  readonly moduleNames: readonly string[];
  readonly patchCount: number;
  readonly stateCounts: readonly (number | null)[];
  readonly subscriberTypes: readonly string[];
  readonly timelineTypes: readonly string[];
  readonly trimmedTypes: readonly string[];
};

declare global {
  interface Window {
    __cosystemDevtoolsSmoke?: {
      readonly ready: Promise<void>;
      clear(): Promise<void>;
      fail(): Promise<void>;
      increase(): Promise<void>;
      read(): SmokeSnapshot;
      trim(): Promise<void>;
      unsubscribe(): Promise<void>;
    };
  }
}

class DevtoolsBrowserCounter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(DevtoolsBrowserCounter, {
  actions: ["increase"],
  name: "devtoolsBrowserCounter",
  state: ["count"],
});

class DevtoolsFailingAction {
  fail(): void {
    throw new Error("boom");
  }
}

defineModule(DevtoolsFailingAction, {
  actions: ["fail"],
  name: "devtoolsFailingAction",
});

class DevtoolsTrimCounter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(DevtoolsTrimCounter, {
  actions: ["increase"],
  name: "devtoolsTrimCounter",
  state: ["count"],
});

const devtools = createDevtoolsPlugin();
const subscriberTypes: string[] = [];
const unsubscribeDevtools = devtools.subscribe((event) => {
  subscriberTypes.push(event.type);
});
const app = createApp({
  plugins: [devtools],
  providers: [DevtoolsBrowserCounter, DevtoolsFailingAction],
});
const trimDevtools = createDevtoolsPlugin({
  maxEvents: 2,
});
const trimApp = createApp({
  plugins: [trimDevtools],
  providers: [DevtoolsTrimCounter],
});

let counter: DevtoolsBrowserCounter;
let failingAction: DevtoolsFailingAction;
let trimCounter: DevtoolsTrimCounter;
let subscribed = true;

const ready = start();

window.__cosystemDevtoolsSmoke = {
  ready,
  clear,
  fail,
  increase,
  read,
  trim,
  unsubscribe,
};

getElement<HTMLButtonElement>("increase").addEventListener("click", () => {
  void runButtonAction(increase);
});
getElement<HTMLButtonElement>("fail").addEventListener("click", () => {
  void runButtonAction(fail);
});
getElement<HTMLButtonElement>("trim").addEventListener("click", () => {
  void runButtonAction(trim);
});
getElement<HTMLButtonElement>("clear").addEventListener("click", () => {
  void runButtonAction(clear);
});
getElement<HTMLButtonElement>("unsubscribe").addEventListener("click", () => {
  void runButtonAction(unsubscribe);
});

async function start(): Promise<void> {
  await app.start();
  counter = app.getModule(DevtoolsBrowserCounter);
  failingAction = app.getModule(DevtoolsFailingAction);
  trimCounter = trimApp.getModule(DevtoolsTrimCounter);
  render("ready");
}

async function increase(): Promise<void> {
  counter.increase();
  render("ready");
}

async function fail(): Promise<void> {
  try {
    failingAction.fail();
  } catch (error) {
    render("ready");
    return;
  }

  throw new Error("Expected failing action to throw.");
}

async function trim(): Promise<void> {
  trimCounter.increase();
  render("ready");
}

async function clear(): Promise<void> {
  devtools.clearTimeline();
  render("ready");
}

async function unsubscribe(): Promise<void> {
  if (subscribed) {
    subscribed = false;
    unsubscribeDevtools();
  }

  render("ready");
}

function read(): SmokeSnapshot {
  const timeline = devtools.getTimeline();
  const actionEvents = timeline.filter(isActionEvent);
  const errorEvents = timeline.filter(isErrorEvent);
  const moduleEvents = timeline.filter(isModuleEvent);
  const stateEvents = timeline.filter(isStateEvent);

  return {
    actionMethods: actionEvents.map((event) => event.event.method),
    count: counter.count,
    errorMessages: errorEvents.map((event) =>
      event.error instanceof Error ? event.error.message : String(event.error),
    ),
    errorPhases: errorEvents.map((event) => event.context.phase),
    moduleNames: moduleEvents.map((event) => event.event.name),
    patchCount: timeline.filter((event) => event.type === "patch").length,
    stateCounts: stateEvents.map((event) => {
      const state = event.event.state as AppState;
      return state.devtoolsBrowserCounter?.count ?? null;
    }),
    subscriberTypes: [...subscriberTypes],
    timelineTypes: timeline.map((event) => event.type),
    trimmedTypes: trimDevtools.getTimeline().map((event) => event.type),
  };
}

function render(status: string): void {
  const snapshot = read();

  getElement("status").textContent = status;
  getElement("count").textContent = String(snapshot.count);
  getElement("timeline-count").textContent = String(snapshot.timelineTypes.length);
  getElement("last-event").textContent = snapshot.timelineTypes.at(-1) ?? "none";
  getElement("error-count").textContent = String(snapshot.errorMessages.length);
  getElement("subscriber-count").textContent = String(snapshot.subscriberTypes.length);
  getElement("trimmed-events").textContent = snapshot.trimmedTypes.join(",") || "none";
}

async function runButtonAction(action: () => Promise<void>): Promise<void> {
  await action();
}

function isActionEvent(
  event: BrowserDevtoolsTimelineEvent,
): event is Extract<BrowserDevtoolsTimelineEvent, { readonly type: "action:start" | "action:end" }> {
  return event.type === "action:start" || event.type === "action:end";
}

function isModuleEvent(
  event: BrowserDevtoolsTimelineEvent,
): event is Extract<BrowserDevtoolsTimelineEvent, { readonly type: "module" }> {
  return event.type === "module";
}

function isErrorEvent(
  event: BrowserDevtoolsTimelineEvent,
): event is Extract<BrowserDevtoolsTimelineEvent, { readonly type: "error" }> {
  return event.type === "error";
}

function isStateEvent(
  event: BrowserDevtoolsTimelineEvent,
): event is Extract<BrowserDevtoolsTimelineEvent, { readonly type: "state" }> {
  return event.type === "state";
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

async function runDevtoolsSmoke(browserInstance, url) {
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
    await page.evaluate(() => window.__cosystemDevtoolsSmoke?.ready);
    await expectText(page, "h1", "Devtools browser smoke");
    await expectStat(page, "Status", "ready");

    const initial = await readSmokeSnapshot(page);
    assertIncludes(initial.timelineTypes, "module", "initial timeline types");
    assertIncludes(initial.timelineTypes, "setup", "initial timeline types");
    assertIncludes(initial.moduleNames, "devtoolsBrowserCounter", "initial module names");

    await clickButton(page, "Increase");
    await expectStat(page, "Count", "1");
    await expectStat(page, "Last event", "action:end");

    const afterIncrease = await readSmokeSnapshot(page);
    assertActionCycle(afterIncrease, "increase");
    assertIncludes(afterIncrease.stateCounts, 1, "state counts after increase");
    assertAtLeast(afterIncrease.patchCount, 1, "patch count after increase");
    assertArraysEqual(
      afterIncrease.subscriberTypes,
      afterIncrease.timelineTypes,
      "subscriber events while subscribed",
    );

    await clickButton(page, "Clear timeline");
    await expectStat(page, "Timeline count", "0");
    await expectStat(page, "Last event", "none");

    const afterClear = await readSmokeSnapshot(page);
    assertArraysEqual(afterClear.timelineTypes, [], "timeline types after clear");

    await clickButton(page, "Unsubscribe");
    const beforeUnsubscribedAction = await readSmokeSnapshot(page);

    await clickButton(page, "Increase");
    await expectStat(page, "Count", "2");
    await expectStat(page, "Last event", "action:end");

    const afterUnsubscribedAction = await readSmokeSnapshot(page);
    assertActionCycle(afterUnsubscribedAction, "increase");
    assertIncludes(afterUnsubscribedAction.stateCounts, 2, "state counts after unsubscribe");
    assertArraysEqual(
      afterUnsubscribedAction.subscriberTypes,
      beforeUnsubscribedAction.subscriberTypes,
      "subscriber events after unsubscribe",
    );

    await clickButton(page, "Fail");
    await expectStat(page, "Error count", "1");
    await expectStat(page, "Last event", "action:end");

    const afterFailure = await readSmokeSnapshot(page);
    assertIncludes(afterFailure.timelineTypes, "error", "timeline types after failure");
    assertIncludes(afterFailure.actionMethods, "fail", "action methods after failure");
    assertIncludes(afterFailure.errorMessages, "boom", "error messages after failure");
    assertIncludes(afterFailure.errorPhases, "action", "error phases after failure");
    assertArraysEqual(
      afterFailure.subscriberTypes,
      beforeUnsubscribedAction.subscriberTypes,
      "subscriber events after failing action while unsubscribed",
    );

    await clickButton(page, "Trim timeline");
    await expectStat(page, "Trimmed events", "patch,action:end");

    const afterTrim = await readSmokeSnapshot(page);
    assertArraysEqual(afterTrim.trimmedTypes, ["patch", "action:end"], "trimmed timeline types");

    if (errors.length > 0) {
      throw new Error(`Installed devtools smoke emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
}

async function readSmokeSnapshot(page) {
  return await page.evaluate(() => {
    const smoke = window.__cosystemDevtoolsSmoke;

    if (smoke === undefined) {
      throw new Error("Devtools smoke API was not registered.");
    }

    return smoke.read();
  });
}

function assertActionCycle(snapshot, method) {
  assertIncludes(snapshot.timelineTypes, "action:start", "timeline types");
  assertIncludes(snapshot.timelineTypes, "state", "timeline types");
  assertIncludes(snapshot.timelineTypes, "patch", "timeline types");
  assertIncludes(snapshot.timelineTypes, "action:end", "timeline types");
  assertIncludes(snapshot.actionMethods, method, "action methods");
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

function assertArraysEqual(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label} mismatch.\nActual: ${JSON.stringify(actual)}\nExpected: ${JSON.stringify(
        expected,
      )}`,
    );
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
        "Unable to launch Chromium for installed devtools browser smoke.",
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

async function clickButton(page, label) {
  await page.getByRole("button", { name: label }).click();
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
    throw new Error(`Missing built devtools smoke asset: ${path}`);
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

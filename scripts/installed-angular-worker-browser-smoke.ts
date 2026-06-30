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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-angular-worker-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const angularTarball = await packPackage("@cosystem/angular");
  const coreTarball = await packPackage("@cosystem/core");

  await writeConsumerProject({ angularTarball, catalog, coreTarball });
  await run("pnpm", ["install", "--offline"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runAngularWorkerBrowserSmoke(browser, server.url);

  console.log("Verified installed Angular worker adapter browser DOM integration.");
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

async function writeConsumerProject({ angularTarball, catalog, coreTarball }) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-angular-worker-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@angular/common": readCatalogVersion(catalog, "@angular/common"),
          "@angular/compiler": readCatalogVersion(catalog, "@angular/compiler"),
          "@angular/core": readCatalogVersion(catalog, "@angular/core"),
          "@angular/platform-browser": readCatalogVersion(catalog, "@angular/platform-browser"),
          "@cosystem/angular": `file:${angularTarball}`,
          "@cosystem/core": `file:${coreTarball}`,
          coaction: readCatalogVersion(catalog, "coaction"),
          rxjs: readCatalogVersion(catalog, "rxjs"),
          "zone.js": readCatalogVersion(catalog, "zone.js"),
        },
        devDependencies: {
          "@analogjs/vite-plugin-angular": readCatalogVersion(
            catalog,
            "@analogjs/vite-plugin-angular",
          ),
          "@angular/build": readCatalogVersion(catalog, "@angular/build"),
          "@angular/compiler-cli": readCatalogVersion(catalog, "@angular/compiler-cli"),
          "@types/node": readCatalogVersion(catalog, "@types/node"),
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
      "  lmdb: true",
      "  msgpackr-extract: true",
      "overrides:",
      `  "@analogjs/vite-plugin-angular": ${JSON.stringify(readCatalogVersion(catalog, "@analogjs/vite-plugin-angular"))}`,
      `  "@angular/build": ${JSON.stringify(readCatalogVersion(catalog, "@angular/build"))}`,
      `  "@angular/common": ${JSON.stringify(readCatalogVersion(catalog, "@angular/common"))}`,
      `  "@angular/compiler": ${JSON.stringify(readCatalogVersion(catalog, "@angular/compiler"))}`,
      `  "@angular/compiler-cli": ${JSON.stringify(readCatalogVersion(catalog, "@angular/compiler-cli"))}`,
      `  "@angular/core": ${JSON.stringify(readCatalogVersion(catalog, "@angular/core"))}`,
      `  "@angular/platform-browser": ${JSON.stringify(readCatalogVersion(catalog, "@angular/platform-browser"))}`,
      `  "@cosystem/angular": ${JSON.stringify(`file:${angularTarball}`)}`,
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "@types/node": ${JSON.stringify(readCatalogVersion(catalog, "@types/node"))}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "rxjs": ${JSON.stringify(readCatalogVersion(catalog, "rxjs"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      `  "vite": ${JSON.stringify(readCatalogVersion(catalog, "vite"))}`,
      `  "zone.js": ${JSON.stringify(readCatalogVersion(catalog, "zone.js"))}`,
      "",
    ].join("\n"),
  );
  await writeFile(
    join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        angularCompilerOptions: {
          strictTemplates: true,
        },
        compilerOptions: {
          declarationMap: false,
          emitDecoratorMetadata: false,
          experimentalDecorators: true,
          isolatedDeclarations: false,
          lib: ["DOM", "DOM.Iterable", "ES2023", "WebWorker"],
          module: "ESNext",
          moduleResolution: "Bundler",
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["node", "vite/client"],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerDir, "vite.config.ts"),
    [
      'import { dirname, resolve } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      'import angular from "@analogjs/vite-plugin-angular";',
      'import { defineConfig } from "vite";',
      "",
      "const root = dirname(fileURLToPath(import.meta.url));",
      "",
      "export default defineConfig({",
      "  plugins: [",
      "    angular({",
      '      tsconfig: resolve(root, "tsconfig.json"),',
      "    }),",
      "  ],",
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
      "    <title>CoSystem Angular worker browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Angular worker browser smoke">',
      "      <h1>Angular worker browser smoke</h1>",
      "      <cosystem-smoke></cosystem-smoke>",
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
  return `// oxlint-disable-next-line import/no-unassigned-import -- Angular requires Zone.js as a runtime side effect.
import "zone.js";

import { Component, signal, type ApplicationRef } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import {
  createPostMessageWorkerTransport,
  createWorkerClient,
  type AsyncMethodProxy,
  type WorkerClient,
} from "@cosystem/core";
import { injectWorkerModule, injectWorkerSignal, provideWorkerClient } from "@cosystem/angular";

type AngularWorkerCounterApi = {
  failAfterIncrease(step?: number): Promise<void>;
  increase(step?: number): Promise<number>;
  increaseLater(step?: number): Promise<number>;
  reset(): Promise<number>;
};

type AngularWorkerState = {
  readonly angularWorkerCounter: {
    readonly count: number;
    readonly phase: string;
  };
};

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
    __cosystemAngularWorkerStage?: string;
    __cosystemAngularWorkerSmoke?: {
      readonly client: WorkerClient;
      readonly ready: Promise<void>;
      dispose(): void;
      snapshot(): SmokeSnapshot;
    };
  }
}

const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
let applicationRef: ApplicationRef | undefined;
const ready = start();

window.__cosystemAngularWorkerStage = "client-created";
window.__cosystemAngularWorkerSmoke = {
  client,
  dispose() {
    applicationRef?.destroy();
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

@Component({
  selector: "cosystem-smoke",
  standalone: true,
  template: \`
    <section aria-label="Angular worker adapter smoke">
      <dl>
        <div><dt>Status</dt><dd id="status">{{ status() }}</dd></div>
        <div><dt>Count</dt><dd id="count">{{ count() }}</dd></div>
        <div><dt>Phase</dt><dd id="phase">{{ phase() }}</dd></div>
        <div><dt>State version</dt><dd id="state-version">{{ stateVersion() }}</dd></div>
        <div><dt>Last result</dt><dd id="last-result">{{ lastResult() }}</dd></div>
        <div><dt>Last error</dt><dd id="last-error">{{ lastError() }}</dd></div>
        <div><dt>Parity</dt><dd id="parity">{{ parity().parity }}</dd></div>
      </dl>
      <button id="increase-two" type="button" (click)="increaseBy(2)">Increase by 2</button>
      <button id="increase-one" type="button" (click)="increaseBy(1)">Increase by 1</button>
      <button id="increase-async" type="button" (click)="increaseAsync()">Increase async</button>
      <button id="fail-after-increase" type="button" (click)="failAfterIncrease()">Fail after increase</button>
      <button id="reset" type="button" (click)="reset()">Reset</button>
    </section>
  \`,
})
class SmokeRoot {
  readonly counter: AsyncMethodProxy<AngularWorkerCounterApi> =
    injectWorkerModule<AngularWorkerCounterApi>("angularWorkerCounter");
  readonly count = injectWorkerSignal(selectCount);
  readonly phase = injectWorkerSignal(selectPhase);
  readonly stateVersion = injectWorkerSignal((_state, currentClient) => currentClient.state.version);
  readonly parity = injectWorkerSignal(
    (state) => ({
      parity: selectCount(state) % 2,
    }),
    {
      equals: (value, previous) => value.parity === previous.parity,
    },
  );
  readonly status = signal("ready");
  readonly lastResult = signal("none");
  readonly lastError = signal("none");

  async increaseBy(step: number): Promise<void> {
    this.status.set("pending");
    this.lastError.set("none");

    try {
      this.lastResult.set(String(await this.counter.increase(step)));
    } finally {
      this.status.set("ready");
    }
  }

  async increaseAsync(): Promise<void> {
    this.status.set("pending");
    this.lastError.set("none");

    try {
      this.lastResult.set(String(await this.counter.increaseLater(3)));
    } finally {
      this.status.set("ready");
    }
  }

  async failAfterIncrease(): Promise<void> {
    this.status.set("pending");
    this.lastResult.set("none");

    try {
      await this.counter.failAfterIncrease(4);
      this.lastError.set("missing rejection");
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.status.set("ready");
    }
  }

  async reset(): Promise<void> {
    this.status.set("pending");
    this.lastError.set("none");

    try {
      this.lastResult.set(String(await this.counter.reset()));
    } finally {
      this.status.set("ready");
    }
  }
}

async function start(): Promise<void> {
  await client.ready;

  window.__cosystemAngularWorkerStage = "before-bootstrap";
  applicationRef = await bootstrapApplication(SmokeRoot, {
    providers: [provideWorkerClient(client)],
  });
  window.__cosystemAngularWorkerStage = "bootstrapped";
}

function selectCount(state: unknown): number {
  return (state as AngularWorkerState).angularWorkerCounter.count;
}

function selectPhase(state: unknown): string {
  return (state as AngularWorkerState).angularWorkerCounter.phase;
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

class AngularWorkerCounter {
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

defineModule(AngularWorkerCounter, {
  actions: ["failAfterIncrease", "increase", "increaseLater", "reset"],
  name: "angularWorkerCounter",
  state: ["count", "phase"],
});

const host = createWorkerApp({
  providers: [AngularWorkerCounter],
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

async function runAngularWorkerBrowserSmoke(currentBrowser, url) {
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
    const response = await page.goto(url);
    await waitForAngularSmokeReady(page, consoleErrors, pageErrors, response);

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

    const snapshot = await page.evaluate(() => window.__cosystemAngularWorkerSmoke?.snapshot());

    expectJsonEqual(
      snapshot,
      {
        count: 0,
        lastError: "none",
        lastResult: "0",
        parity: "0",
        phase: "reset",
        state: {
          angularWorkerCounter: {
            count: 0,
            phase: "reset",
          },
        },
        stateVersion: snapshot?.stateVersion,
        status: "ready",
      },
      "final Angular worker browser snapshot",
    );
    assertAtLeast(snapshot?.stateVersion ?? 0, 5, "worker state version");

    await page.evaluate(() => window.__cosystemAngularWorkerSmoke?.dispose());

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(
        [
          "Angular worker browser smoke emitted browser errors.",
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

async function waitForAngularSmokeReady(page, consoleErrors, pageErrors, response) {
  try {
    await page.waitForFunction(() => window.__cosystemAngularWorkerStage === "bootstrapped");
    await page.evaluate(() => window.__cosystemAngularWorkerSmoke?.ready);
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      body: document.body.textContent?.trim() ?? "",
      readyState: document.readyState,
      scripts: Array.from(document.scripts, (script) => script.src),
      stage: window.__cosystemAngularWorkerStage,
      smokeType: typeof window.__cosystemAngularWorkerSmoke,
      title: document.title,
      url: window.location.href,
    }));

    throw new Error(
      [
        "Angular worker browser smoke did not initialize.",
        `response: ${String(response?.status())}`,
        `diagnostics: ${JSON.stringify(diagnostics)}`,
        ...consoleErrors.map((message) => `console: ${message}`),
        ...pageErrors.map((message) => `page: ${message}`),
      ].join("\n"),
      { cause: error },
    );
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
        "Unable to launch Chromium for Angular worker browser smoke.",
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
    throw new Error(`Missing built Angular worker browser asset: ${path}`);
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

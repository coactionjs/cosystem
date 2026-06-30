#!/usr/bin/env node
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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-storage-indexeddb-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();
const storageName = `cosystem-storage-indexeddb-smoke-${Date.now()}`;

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const storageTarball = await packPackage("@cosystem/storage");

  await writeConsumerProject(coreTarball, storageTarball, catalog);
  await run("pnpm", ["install", "--offline"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runIndexedDBSmoke(browser, server.url);

  console.log("Verified installed storage IndexedDB browser persistence.");
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

async function writeConsumerProject(coreTarball, storageTarball, catalog) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-storage-indexeddb-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
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
      "    <title>CoSystem IndexedDB storage smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="IndexedDB storage smoke">',
      "      <h1>IndexedDB storage smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Driver</dt><dd id="driver">unknown</dd></div>',
      '        <div><dt>Token driver</dt><dd id="token-driver">unknown</dd></div>',
      '        <div><dt>Count</dt><dd id="count">0</dd></div>',
      '        <div><dt>Stored count</dt><dd id="stored-count">empty</dd></div>',
      '        <div><dt>Batch</dt><dd id="batch">empty</dd></div>',
      "      </dl>",
      '      <button type="button" id="increase">Increase</button>',
      '      <button type="button" id="run-batch">Run batch</button>',
      '      <button type="button" id="clear">Clear stored state</button>',
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
import {
  StorageToken,
  createLocalSpaceStoragePlugin,
  indexedDBDriver,
  type LocalSpaceStoragePlugin,
  type StorageTransactionScope,
} from "@cosystem/storage";

type AppState = {
  readonly indexedDBCounter?: {
    readonly count: number;
  };
};

type CountValue = {
  readonly value: number;
};

type SmokeSnapshot = {
  readonly batch: string;
  readonly count: number;
  readonly driver: string | null;
  readonly storedCount: number | null;
  readonly tokenDriver: string | null;
};

declare global {
  interface Window {
    __cosystemIndexedDBStorageSmoke?: {
      readonly ready: Promise<void>;
      clear(): Promise<void>;
      drop(): Promise<void>;
      increase(): Promise<void>;
      read(): Promise<SmokeSnapshot>;
      runBatch(): Promise<void>;
    };
  }
}

const storageName = ${JSON.stringify(storageName)};
const storageStoreName = "state";
const storageKey = "app";
const indexedDBDriverName = indexedDBDriver._driver;

class IndexedDBCounter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(IndexedDBCounter, {
  actions: ["increase"],
  name: "indexedDBCounter",
  state: ["count"],
});

const plugin: LocalSpaceStoragePlugin = createLocalSpaceStoragePlugin<AppState>({
  destroyOnDispose: false,
  key: storageKey,
  options: {
    driver: indexedDBDriverName,
    name: storageName,
    storeName: storageStoreName,
  },
});
const app = createApp({
  plugins: [plugin],
  providers: [IndexedDBCounter],
});

let counter: IndexedDBCounter;

const ready = start();

window.__cosystemIndexedDBStorageSmoke = {
  ready,
  clear,
  drop,
  increase,
  read,
  runBatch,
};

getElement<HTMLButtonElement>("increase").addEventListener("click", () => {
  void runButtonAction(increase);
});
getElement<HTMLButtonElement>("run-batch").addEventListener("click", () => {
  void runButtonAction(runBatch);
});
getElement<HTMLButtonElement>("clear").addEventListener("click", () => {
  void runButtonAction(clear);
});

async function start(): Promise<void> {
  await app.start();
  counter = app.getModule(IndexedDBCounter);
  await render("ready");
}

async function increase(): Promise<void> {
  counter.increase();
  await plugin.flush();
  await render("ready");
}

async function runBatch(): Promise<void> {
  await plugin.storage.setMany<CountValue>([
    { key: "alpha", value: { value: 1 } },
    { key: "beta", value: { value: 2 } },
  ]);
  await plugin.storage.transaction("readwrite", async (scope: StorageTransactionScope) => {
    const alpha = await scope.get<CountValue>("alpha");

    await scope.set("gamma", { value: (alpha?.value ?? 0) + 2 });
    await scope.remove("beta");
  });
  await render("ready");
}

async function clear(): Promise<void> {
  await plugin.clear();
  await plugin.flush();
  await render("ready");
}

async function drop(): Promise<void> {
  await app.dispose();
  await plugin.storage.dropInstance({
    name: storageName,
    storeName: storageStoreName,
  });
  await plugin.storage.destroy();
}

async function read(): Promise<SmokeSnapshot> {
  const stored = await plugin.storage.get<AppState>(storageKey);
  const batchItems = await plugin.storage.getMany<CountValue>(["alpha", "beta", "gamma"]);

  return {
    batch: batchItems
      .map((item: { readonly key: string; readonly value: CountValue | null }) => item.value?.value ?? null)
      .join(","),
    count: counter.count,
    driver: plugin.storage.driver(),
    storedCount: stored?.indexedDBCounter?.count ?? null,
    tokenDriver: app.get(StorageToken).driver(),
  };
}

async function render(status: string): Promise<void> {
  const snapshot = await read();

  getElement("status").textContent = status;
  getElement("driver").textContent = snapshot.driver ?? "none";
  getElement("token-driver").textContent = snapshot.tokenDriver ?? "none";
  getElement("count").textContent = String(snapshot.count);
  getElement("stored-count").textContent =
    snapshot.storedCount === null ? "empty" : String(snapshot.storedCount);
  getElement("batch").textContent = snapshot.batch;
}

async function runButtonAction(action: () => Promise<void>): Promise<void> {
  try {
    getElement("status").textContent = "working";
    await action();
  } catch (error) {
    getElement("status").textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (element === null) {
    throw new Error(\`Missing element: \${id}\`);
  }

  return element as T;
}
`;
}

async function runIndexedDBSmoke(browserInstance, url) {
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
    await expectStorageState(page, {
      batch: ",,",
      count: 0,
      storedCount: null,
    });

    await clickButton(page, "Run batch");
    await expectStorageState(page, {
      batch: "1,,3",
      count: 0,
      storedCount: null,
    });

    await clickButton(page, "Increase");
    await clickButton(page, "Increase");
    await expectStorageState(page, {
      batch: "1,,3",
      count: 2,
      storedCount: 2,
    });

    await page.reload({ waitUntil: "networkidle" });
    await expectStorageState(page, {
      batch: "1,,3",
      count: 2,
      storedCount: 2,
    });

    await clickButton(page, "Clear stored state");
    await expectStorageState(page, {
      batch: "1,,3",
      count: 2,
      storedCount: null,
    });

    await page.reload({ waitUntil: "networkidle" });
    await expectStorageState(page, {
      batch: "1,,3",
      count: 0,
      storedCount: null,
    });

    if (errors.length > 0) {
      throw new Error(`IndexedDB storage smoke emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await page
      .evaluate(() => window["__cosystemIndexedDBStorageSmoke"]?.drop())
      .catch(() => undefined);
    await context.close();
  }
}

async function expectStorageState(page, expected) {
  await waitForStorageSmoke(page);
  await expectStat(page, "Status", "ready");
  await expectStat(page, "Driver", "asyncStorage");
  await expectStat(page, "Token driver", "asyncStorage");
  await expectStat(page, "Count", String(expected.count));
  await expectStat(
    page,
    "Stored count",
    expected.storedCount === null ? "empty" : String(expected.storedCount),
  );
  await expectStat(page, "Batch", expected.batch);

  const snapshot = await page.evaluate(() => window["__cosystemIndexedDBStorageSmoke"]?.read());

  if (snapshot === undefined) {
    throw new Error("IndexedDB storage smoke API was not exposed.");
  }

  if (
    snapshot.batch !== expected.batch ||
    snapshot.count !== expected.count ||
    snapshot.driver !== "asyncStorage" ||
    snapshot.storedCount !== expected.storedCount ||
    snapshot.tokenDriver !== "asyncStorage"
  ) {
    throw new Error(`IndexedDB storage state mismatch: ${JSON.stringify(snapshot)}`);
  }
}

async function waitForStorageSmoke(page) {
  await page.waitForFunction(() => window["__cosystemIndexedDBStorageSmoke"] !== undefined);
  await page.evaluate(() => window["__cosystemIndexedDBStorageSmoke"]?.ready);
}

async function expectStat(page, label, expected) {
  try {
    await page.waitForFunction(
      ({ expectedValue, labelText }) => {
        const labels = [...document.querySelectorAll("dt")];
        const labelElement = labels.find((element) => element.textContent?.trim() === labelText);
        const valueElement = labelElement?.parentElement?.querySelector("dd");

        return valueElement?.textContent?.trim() === expectedValue;
      },
      { expectedValue: expected, labelText: label },
    );
  } catch (error) {
    const stats = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll("dt")].map((element) => [
          element.textContent?.trim() ?? "",
          element.parentElement?.querySelector("dd")?.textContent?.trim() ?? "",
        ]),
      ),
    );

    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(stats)}`, {
      cause: error,
    });
  }
}

async function clickButton(page, label) {
  await page.getByRole("button", { name: label }).click();
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
        "Unable to launch Chromium for IndexedDB storage browser smoke.",
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
    throw new Error(`Missing built browser IndexedDB storage asset: ${path}`);
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

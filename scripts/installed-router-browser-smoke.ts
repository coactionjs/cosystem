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
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-router-browser-"));
const tarballsDir = join(tempDir, "tarballs");
const consumerDir = join(tempDir, "consumer");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

let browser;
let server;

try {
  const catalog = await readCatalog();
  const coreTarball = await packPackage("@cosystem/core");
  const routerTarball = await packPackage("@cosystem/router");

  await writeConsumerProject(coreTarball, routerTarball, catalog);
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], consumerDir);
  await run("pnpm", ["run", "typecheck"], consumerDir);
  await run("pnpm", ["run", "build"], consumerDir);

  server = await createStaticServer(join(consumerDir, "dist"));
  browser = await launchBrowser();

  await runRouterSmoke(browser, server.url);

  console.log("Verified installed router browser history integration.");
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

async function writeConsumerProject(coreTarball, routerTarball, catalog) {
  await mkdir(join(consumerDir, "src"), { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-router-browser-smoke",
        private: true,
        type: "module",
        scripts: {
          build: "vite build --logLevel error",
          typecheck: "tsc -p tsconfig.json --noEmit",
        },
        dependencies: {
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/router": `file:${routerTarball}`,
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
      `  "@cosystem/router": ${JSON.stringify(`file:${routerTarball}`)}`,
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
      "    <title>CoSystem router browser smoke</title>",
      "  </head>",
      "  <body>",
      '    <main aria-label="Router smoke">',
      "      <h1>Router browser smoke</h1>",
      "      <dl>",
      '        <div><dt>Status</dt><dd id="status">starting</dd></div>',
      '        <div><dt>Current</dt><dd id="current">/</dd></div>',
      '        <div><dt>Href</dt><dd id="href">/</dd></div>',
      '        <div><dt>Router provided</dt><dd id="provided">false</dd></div>',
      '        <div><dt>Events</dt><dd id="events">none</dd></div>',
      "      </dl>",
      '      <button type="button" id="settings">Settings</button>',
      '      <button type="button" id="profile">Profile</button>',
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
  return `import { createApp } from "@cosystem/core";
import {
  RouterToken,
  createBrowserRouter,
  createRouterPlugin,
  formatLocation,
  parseLocation,
  type RouteLocation,
} from "@cosystem/router";

type SmokeSnapshot = {
  readonly current: string;
  readonly events: readonly string[];
  readonly formatted: string;
  readonly href: string;
  readonly parsed: RouteLocation;
  readonly provided: boolean;
};

declare global {
  interface Window {
    __cosystemRouterSmoke?: {
      readonly ready: Promise<void>;
      dispose(): Promise<void>;
      navigate(to: string | RouteLocation): Promise<void>;
      read(): SmokeSnapshot;
    };
  }
}

const router = createBrowserRouter();
const events: string[] = [];
const app = createApp({
  plugins: [
    createRouterPlugin(router, {
      immediate: true,
      onChange(location, activeApp) {
        events.push(formatLocation(location) + ":" + String(activeApp.get(RouterToken) === router));
        render("ready");
      },
    }),
  ],
});
const providedRouter = app.get(RouterToken);

const ready = start();

window.__cosystemRouterSmoke = {
  ready,
  dispose,
  navigate,
  read,
};

getElement<HTMLButtonElement>("settings").addEventListener("click", () => {
  void navigate("/settings?mode=dark#panel");
});
getElement<HTMLButtonElement>("profile").addEventListener("click", () => {
  void navigate({ hash: "#details", path: "/profile", search: "?tab=info" });
});

async function start(): Promise<void> {
  await app.start();
  render("ready");
}

async function navigate(to: string | RouteLocation): Promise<void> {
  router.navigate(to);
  render("ready");
}

async function dispose(): Promise<void> {
  await app.dispose();
  render("disposed");
}

function read(): SmokeSnapshot {
  return {
    current: formatLocation(router.current),
    events: [...events],
    formatted: formatLocation({ hash: "#typed", path: "/typed", search: "?via=format" }),
    href: location.pathname + location.search + location.hash,
    parsed: parseLocation("/parsed?via=parse#hash"),
    provided: providedRouter === router,
  };
}

function render(status: string): void {
  const snapshot = read();

  getElement("status").textContent = status;
  getElement("current").textContent = snapshot.current;
  getElement("href").textContent = snapshot.href;
  getElement("provided").textContent = String(snapshot.provided);
  getElement("events").textContent = snapshot.events.join(" | ") || "none";
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

async function runRouterSmoke(browserInstance, url) {
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
    await expectText(page, "h1", "Router browser smoke");
    await expectRouterState(page, {
      current: "/",
      events: ["/:true"],
      href: "/",
      status: "ready",
    });

    const initialSnapshot = await readRouterSmoke(page);
    expectJsonEqual(
      initialSnapshot.parsed,
      { hash: "#hash", path: "/parsed", search: "?via=parse" },
      "parsed location",
    );
    expectEqual(initialSnapshot.formatted, "/typed?via=format#typed", "formatted location");

    await clickButton(page, "Settings");
    await expectRouterState(page, {
      current: "/settings?mode=dark#panel",
      events: ["/:true", "/settings?mode=dark#panel:true"],
      href: "/settings?mode=dark#panel",
      status: "ready",
    });

    await clickButton(page, "Profile");
    await expectRouterState(page, {
      current: "/profile?tab=info#details",
      events: ["/:true", "/settings?mode=dark#panel:true", "/profile?tab=info#details:true"],
      href: "/profile?tab=info#details",
      status: "ready",
    });

    await page.goBack({ waitUntil: "networkidle" });
    await expectRouterState(page, {
      current: "/settings?mode=dark#panel",
      events: [
        "/:true",
        "/settings?mode=dark#panel:true",
        "/profile?tab=info#details:true",
        "/settings?mode=dark#panel:true",
      ],
      href: "/settings?mode=dark#panel",
      status: "ready",
    });

    await page.evaluate(() => window.__cosystemRouterSmoke?.dispose());
    await expectRouterState(page, {
      current: "/settings?mode=dark#panel",
      events: [
        "/:true",
        "/settings?mode=dark#panel:true",
        "/profile?tab=info#details:true",
        "/settings?mode=dark#panel:true",
      ],
      href: "/settings?mode=dark#panel",
      status: "disposed",
    });

    await page.evaluate(() => window.__cosystemRouterSmoke?.navigate("/after-dispose"));
    await expectRouterState(page, {
      current: "/after-dispose",
      events: [
        "/:true",
        "/settings?mode=dark#panel:true",
        "/profile?tab=info#details:true",
        "/settings?mode=dark#panel:true",
      ],
      href: "/after-dispose",
      status: "ready",
    });

    if (errors.length > 0) {
      throw new Error(`Router browser smoke emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
}

async function expectRouterState(page, expected) {
  await waitForRouterSmoke(page);
  await expectStat(page, "Status", expected.status);
  await expectStat(page, "Current", expected.current);
  await expectStat(page, "Href", expected.href);
  await expectStat(page, "Router provided", "true");
  await expectStat(page, "Events", expected.events.join(" | "));

  const snapshot = await readRouterSmoke(page);

  expectEqual(snapshot.current, expected.current, "snapshot current");
  expectEqual(snapshot.href, expected.href, "snapshot href");
  expectEqual(snapshot.provided, true, "snapshot provided router");
  expectJsonEqual(snapshot.events, expected.events, "snapshot events");
}

async function waitForRouterSmoke(page) {
  await page.waitForFunction(() => window.__cosystemRouterSmoke !== undefined);
  await page.evaluate(() => window.__cosystemRouterSmoke?.ready);
}

async function readRouterSmoke(page) {
  const snapshot = await page.evaluate(() => window.__cosystemRouterSmoke?.read());

  if (snapshot === undefined) {
    throw new Error("Router smoke API was not exposed.");
  }

  return snapshot;
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
        "Unable to launch Chromium for router browser smoke.",
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
    throw new Error(`Missing built router browser asset: ${path}`);
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

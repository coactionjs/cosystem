#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(rootDir, "examples");
const packagesDir = join(rootDir, "packages");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const rootPackagePath = join(rootDir, "package.json");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-installed-examples-"));
const tempExamplesDir = join(tempDir, "examples");
const tarballsDir = join(tempDir, "tarballs");
const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? findSystemChrome();

const exampleSmokes = [
  counterExample("angular-counter", "Increase"),
  counterExample("no-decorator", "Increase", async (page) => {
    await expectText(page, "pre", "count:1");
    await clickButton(page, "Reset");
    await expectStat(page, "Count", "0");
    await expectText(page, "pre", "reset");
  }),
  counterExample("react-counter", "Increase"),
  counterExample("solid-counter", "Increase"),
  counterExample("svelte-counter", "Increase"),
  counterExample("vue-counter", "Increase"),
  {
    dirName: "lazy-module",
    async run(page) {
      await expectText(page, "h1", "Admin counter");
      await expectText(page, "p", "still outside the app graph");
      await expectStat(page, "Count", "0");
      await expectButtonDisabled(page, "Increase");

      await clickButton(page, "Load module");
      await expectText(page, "p", "loaded into the app");
      await expectButtonEnabled(page, "Increase");
      await clickButton(page, "Increase");
      await expectStat(page, "Count", "1");
      await expectStat(page, "Double", "2");
      await clickButton(page, "Reset");
      await expectStat(page, "Count", "0");
      await expectStat(page, "Double", "0");
    },
  },
  {
    dirName: "router",
    async run(page) {
      await expectText(page, "h1", "Current location");
      await expectStat(page, "Path", "/");
      await expectStat(page, "Search", "-");
      await expectStat(page, "Hash", "-");

      await clickButton(page, "Profile settings");
      await expectStat(page, "Path", "/settings");
      await expectStat(page, "Search", "?tab=profile");
      await expectStat(page, "Hash", "-");

      await clickButton(page, "Help shortcuts");
      await expectStat(page, "Path", "/help");
      await expectStat(page, "Search", "-");
      await expectStat(page, "Hash", "#shortcuts");

      await page.goBack();
      await expectStat(page, "Path", "/settings");
      await expectStat(page, "Search", "?tab=profile");
      await expectStat(page, "Hash", "-");

      await page.goBack();
      await expectStat(page, "Path", "/");
      await expectStat(page, "Search", "-");
      await expectStat(page, "Hash", "-");

      await page.goForward();
      await expectStat(page, "Path", "/settings");
      await expectStat(page, "Search", "?tab=profile");
      await expectStat(page, "Hash", "-");

      await page.goForward();
      await expectStat(page, "Path", "/help");
      await expectStat(page, "Search", "-");
      await expectStat(page, "Hash", "#shortcuts");
    },
  },
  {
    dirName: "worker-counter",
    async run(page) {
      await expectText(page, "h1", "Worker counter");
      await expectText(page, "p", "running in a Vite Web Worker");
      await expectButtonEnabled(page, "Increase in worker");
      await clickButton(page, "Increase in worker");
      await expectStat(page, "Count", "1");
      await expectStat(page, "Double", "2");
      await clickButton(page, "Reset");
      await expectStat(page, "Count", "0");
      await expectStat(page, "Double", "0");
    },
  },
];

let browser;

try {
  const catalog = await readCatalog();
  const rootPackageJson = JSON.parse(await readFile(rootPackagePath, "utf8"));
  const packages = await readPublicPackages();
  const buildableExamples = await readBuildableExamples();
  const tarballByName = new Map();

  await mkdir(tarballsDir, { recursive: true });

  for (const pkg of packages) {
    tarballByName.set(pkg.packageJson.name, await packPackage(pkg));
  }

  await writeInstalledExamplesWorkspace(buildableExamples, tarballByName, catalog, rootPackageJson);
  await run("pnpm", ["install", "--offline"], tempDir);

  for (const example of buildableExamples) {
    await run("pnpm", ["--filter", example.name, "run", "typecheck"], tempDir);
    await run("pnpm", ["--filter", example.name, "run", "build"], tempDir);
    await assertExampleBuild({
      dir: join(tempExamplesDir, example.dirName),
      name: example.name,
    });
  }

  browser = await launchBrowser();

  for (const smoke of exampleSmokes) {
    await runExampleSmoke(browser, smoke);
  }

  console.log(
    `Verified installed tarball builds and runtime behavior for ${buildableExamples.length} example app(s).`,
  );
} finally {
  await browser?.close();
  await rm(tempDir, { force: true, recursive: true });
}

function counterExample(dirName, increaseLabel, afterIncrease) {
  return {
    dirName,
    async run(page) {
      await expectText(page, "h1", "Counter module");
      await expectStat(page, "Count", "0");
      await expectStat(page, "Double", "0");

      await clickButton(page, increaseLabel);
      await expectStat(page, "Count", "1");
      await expectStat(page, "Double", "2");

      if (afterIncrease !== undefined) {
        await afterIncrease(page);
        return;
      }

      await clickButton(page, "Reset");
      await expectStat(page, "Count", "0");
      await expectStat(page, "Double", "0");
    },
  };
}

async function readPublicPackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(packagesDir, entry.name);
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));

    if (packageJson.private === true) {
      continue;
    }

    packages.push({
      dir,
      packageJson,
    });
  }

  return packages.toSorted((left, right) =>
    left.packageJson.name.localeCompare(right.packageJson.name),
  );
}

async function readBuildableExamples() {
  const entries = await readdir(examplesDir, { withFileTypes: true });
  const examples = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(examplesDir, entry.name);
    const packageJson = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));

    if (typeof packageJson.scripts?.build !== "string") {
      continue;
    }

    examples.push({
      dir,
      dirName: entry.name,
      name: packageJson.name,
      packageJson,
    });
  }

  return examples.toSorted((left, right) => left.name.localeCompare(right.name));
}

async function packPackage(pkg) {
  const destination = join(
    tarballsDir,
    pkg.packageJson.name.replaceAll("@", "").replaceAll("/", "__"),
  );

  await mkdir(destination, { recursive: true });
  await run("pnpm", ["pack", "--pack-destination", destination], pkg.dir);

  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`${pkg.packageJson.name} must produce exactly one tarball.`);
  }

  return join(destination, tarballs[0]);
}

async function writeInstalledExamplesWorkspace(
  buildableExamples,
  tarballByName,
  catalog,
  rootPackageJson,
) {
  await mkdir(tempExamplesDir, { recursive: true });
  await mkdir(join(tempDir, "packages"), { recursive: true });
  await cp(join(packagesDir, "tsconfig"), join(tempDir, "packages", "tsconfig"), {
    recursive: true,
  });

  for (const example of buildableExamples) {
    const targetDir = join(tempExamplesDir, example.dirName);

    await cp(example.dir, targetDir, {
      filter(source) {
        const name = basename(source);
        return name !== "dist" && name !== "node_modules" && name !== ".turbo";
      },
      recursive: true,
    });
    await writeFile(
      join(targetDir, "package.json"),
      `${JSON.stringify(rewritePackageJson(example.packageJson, tarballByName, catalog), null, 2)}\n`,
    );
  }

  await writeFile(
    join(tempDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-installed-example-build-smoke",
        packageManager: rootPackageJson.packageManager,
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(tempDir, "pnpm-lock.yaml"), await readFile(lockfilePath, "utf8"));
  await writeFile(join(tempDir, "pnpm-workspace.yaml"), createWorkspaceSource(tarballByName));
}

function rewritePackageJson(packageJson, tarballByName, catalog) {
  return {
    ...packageJson,
    dependencies: rewriteDependencyField(packageJson.dependencies, tarballByName, catalog),
    devDependencies: rewriteDependencyField(packageJson.devDependencies, tarballByName, catalog),
    optionalDependencies: rewriteDependencyField(
      packageJson.optionalDependencies,
      tarballByName,
      catalog,
    ),
    peerDependencies: rewriteDependencyField(packageJson.peerDependencies, tarballByName, catalog),
  };
}

function rewriteDependencyField(dependencies, tarballByName, catalog) {
  if (dependencies === undefined) {
    return undefined;
  }

  const rewritten = {};

  for (const [name, range] of Object.entries(dependencies)) {
    if (tarballByName.has(name)) {
      rewritten[name] = `file:${tarballByName.get(name)}`;
      continue;
    }

    if (range === "catalog:") {
      rewritten[name] = readCatalogVersion(catalog, name);
      continue;
    }

    rewritten[name] = range;
  }

  return rewritten;
}

function createWorkspaceSource(tarballByName) {
  const lines = [
    "packages:",
    '  - "examples/*"',
    "allowBuilds:",
    '  "@parcel/watcher": true',
    "  esbuild: true",
    "  lmdb: true",
    "  msgpackr-extract: true",
    "overrides:",
  ];

  for (const [name, tarball] of [...tarballByName.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${JSON.stringify(name)}: ${JSON.stringify(`file:${tarball}`)}`);
  }

  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function assertExampleBuild(example) {
  const distDir = join(example.dir, "dist");
  const indexPath = join(distDir, "index.html");
  const html = await readFile(indexPath, "utf8");
  const assetReferences = readLocalAssetReferences(html);
  const distFiles = await readDistFiles(distDir);

  if (html.includes("/src/")) {
    throw new Error(`${example.name} dist/index.html contains unresolved source paths.`);
  }

  if (!assetReferences.some((reference) => reference.endsWith(".js"))) {
    throw new Error(`${example.name} dist/index.html does not reference a JavaScript entry.`);
  }

  for (const reference of assetReferences) {
    await assertNonEmptyFile(example, join(distDir, reference));
  }

  if (example.name === "@cosystem/example-worker-counter") {
    assertHasMatchingFile(
      example,
      distFiles,
      (file) => file.includes(".worker-") && file.endsWith(".js"),
    );
  }

  if (example.name === "@cosystem/example-lazy-module") {
    assertHasMatchingFile(
      example,
      distFiles,
      (file) => file.includes("/admin-") && file.endsWith(".js"),
    );
  }
}

function readLocalAssetReferences(html) {
  const references = [];
  const pattern = /\b(?:href|src)="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    const value = match[1];

    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:") ||
      value.startsWith("#")
    ) {
      continue;
    }

    references.push(value.startsWith("/") ? value.slice(1) : value);
  }

  return references;
}

async function readDistFiles(root, base = root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await readDistFiles(path, base)));
      continue;
    }

    files.push(path.slice(base.length + 1));
  }

  return files.toSorted();
}

async function assertNonEmptyFile(example, path) {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`${example.name} references missing asset ${path}.`);
  }

  const fileStat = await stat(path);

  if (fileStat.size === 0) {
    throw new Error(`${example.name} references empty asset ${path}.`);
  }
}

function assertHasMatchingFile(example, files, predicate) {
  if (!files.some(predicate)) {
    throw new Error(`${example.name} build output is missing an expected async asset.`);
  }
}

async function runExampleSmoke(browserInstance, smoke) {
  const distDir = join(tempExamplesDir, smoke.dirName, "dist");
  const server = await createStaticServer(distDir);
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
    await page.goto(server.url, { waitUntil: "networkidle" });
    await smoke.run(page);

    if (errors.length > 0) {
      throw new Error(`${smoke.dirName} emitted browser errors:\n${errors.join("\n")}`);
    }
  } finally {
    await context.close();
    await server.close();
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
        "Unable to launch Chromium for installed example runtime smoke.",
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

async function expectButtonEnabled(page, label) {
  await page.getByRole("button", { name: label }).waitFor({ state: "visible" });
  await page.waitForFunction((buttonLabel) => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === buttonLabel,
    );
    return button !== undefined && !button.disabled;
  }, label);
}

async function expectButtonDisabled(page, label) {
  await page.getByRole("button", { name: label }).waitFor({ state: "visible" });
  await page.waitForFunction((buttonLabel) => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === buttonLabel,
    );
    return button !== undefined && button.disabled;
  }, label);
}

async function assertReadableFile(path) {
  const fileStat = await stat(path);

  if (!fileStat.isFile()) {
    throw new Error(`Missing built example asset: ${path}`);
  }
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

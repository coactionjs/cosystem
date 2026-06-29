#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { createServer } from "node:http";
import { accessSync, constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(rootDir, "examples");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-example-runtime-"));
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
  browser = await launchBrowser();

  for (const smoke of exampleSmokes) {
    await runExampleSmoke(browser, smoke);
  }

  console.log(`Verified runtime behavior for ${exampleSmokes.length} example app(s).`);
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

async function runExampleSmoke(browserInstance, smoke) {
  const exampleDir = join(examplesDir, smoke.dirName);
  const distDir = join(exampleDir, "dist");
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
        "Unable to launch Chromium for example runtime smoke.",
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

  const server = createServer(async (request, response) => {
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
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Static server did not expose a TCP address.");
  }

  return {
    close() {
      return new Promise((done, reject) => {
        server.close((error) => {
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
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`Missing built example asset: ${path}`);
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

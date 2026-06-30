#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-scaffold-dlx-"));
const tarballsDir = join(tempDir, "tarballs");
const workspaceDir = join(tempDir, "workspace");
const appName = "dlx-scaffold";
const appDir = join(workspaceDir, appName);

try {
  const catalog = await readCatalog();
  const createTarball = await packPackage("@cosystem/create");
  const coreTarball = await packPackage("@cosystem/core");

  await mkdir(workspaceDir, { recursive: true });

  const createResult = await run(
    "pnpm",
    ["dlx", "--package", `file:${createTarball}`, "create-cosystem", appName],
    workspaceDir,
  );
  const createdPath = createResult.stdout.trim().replace("Created CoSystem project at ", "");
  const [expectedAppDir, reportedAppDir] = await Promise.all([
    realpath(appDir),
    realpath(createdPath),
  ]);

  if (reportedAppDir !== expectedAppDir) {
    throw new Error(
      `pnpm dlx create-cosystem reported unexpected app path:\n${createResult.stdout}`,
    );
  }

  await writeGeneratedAppOverrides(coreTarball, catalog);
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], appDir);
  await run("pnpm", ["run", "build"], appDir);

  const startResult = await run("pnpm", ["run", "start"], appDir);

  if (!startResult.stdout.includes("{ counter: { count: 1 } }")) {
    throw new Error(`pnpm dlx generated app printed unexpected output:\n${startResult.stdout}`);
  }

  console.log("Verified pnpm dlx create-cosystem scaffold build and runtime.");
} finally {
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

async function writeGeneratedAppOverrides(coreTarball, catalog) {
  await writeFile(join(appDir, "pnpm-lock.yaml"), await readFile(lockfilePath, "utf8"));
  await writeFile(
    join(appDir, "pnpm-workspace.yaml"),
    [
      "allowBuilds:",
      "  esbuild: true",
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "tsx": ${JSON.stringify(readCatalogVersion(catalog, "tsx"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      "",
    ].join("\n"),
  );
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

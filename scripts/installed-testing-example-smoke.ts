#!/usr/bin/env node
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const workspacePath = join(rootDir, "pnpm-workspace.yaml");
const lockfilePath = join(rootDir, "pnpm-lock.yaml");
const rootPackagePath = join(rootDir, "package.json");
const sourceExampleDir = join(rootDir, "examples", "testing");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-installed-testing-example-"));
const exampleDir = join(tempDir, "examples", "testing");
const tarballsDir = join(tempDir, "tarballs");

try {
  const catalog = await readCatalog();
  const rootPackageJson = JSON.parse(await readFile(rootPackagePath, "utf8"));
  const coreTarball = await packPackage("@cosystem/core");
  const testingTarball = await packPackage("@cosystem/testing");

  await writeInstalledTestingExample(coreTarball, testingTarball, catalog, rootPackageJson);
  await run("pnpm", ["install", "--prefer-offline", "--no-frozen-lockfile"], tempDir);
  await run("pnpm", ["--filter", "@cosystem/example-testing", "run", "typecheck"], tempDir);
  await run("pnpm", ["--filter", "@cosystem/example-testing", "run", "test"], tempDir);

  console.log("Verified installed @cosystem/testing example test suite.");
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

async function writeInstalledTestingExample(coreTarball, testingTarball, catalog, rootPackageJson) {
  await mkdir(join(tempDir, "examples"), { recursive: true });
  await mkdir(join(tempDir, "packages"), { recursive: true });
  await cp(join(packagesDir, "tsconfig"), join(tempDir, "packages", "tsconfig"), {
    recursive: true,
  });
  await cp(sourceExampleDir, exampleDir, {
    filter(source) {
      const name = basename(source);
      return name !== "node_modules" && name !== ".turbo" && name !== "coverage";
    },
    recursive: true,
  });

  const packageJson = JSON.parse(await readFile(join(sourceExampleDir, "package.json"), "utf8"));

  await writeFile(
    join(exampleDir, "package.json"),
    `${JSON.stringify(
      {
        ...packageJson,
        dependencies: {
          ...rewriteDependencyField(packageJson.dependencies, catalog),
          "@cosystem/core": `file:${coreTarball}`,
          "@cosystem/testing": `file:${testingTarball}`,
        },
        devDependencies: rewriteDependencyField(packageJson.devDependencies, catalog),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(tempDir, "package.json"),
    `${JSON.stringify(
      {
        name: "cosystem-installed-testing-example-smoke",
        packageManager: rootPackageJson.packageManager,
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(tempDir, "pnpm-lock.yaml"), await readFile(lockfilePath, "utf8"));
  await writeFile(
    join(tempDir, "pnpm-workspace.yaml"),
    [
      "packages:",
      '  - "examples/*"',
      "allowBuilds:",
      '  "@parcel/watcher": true',
      "  esbuild: true",
      "overrides:",
      `  "@cosystem/core": ${JSON.stringify(`file:${coreTarball}`)}`,
      `  "@cosystem/testing": ${JSON.stringify(`file:${testingTarball}`)}`,
      `  "coaction": ${JSON.stringify(readCatalogVersion(catalog, "coaction"))}`,
      `  "typescript": ${JSON.stringify(readCatalogVersion(catalog, "typescript"))}`,
      `  "vite": ${JSON.stringify(readCatalogVersion(catalog, "vite"))}`,
      `  "vitest": ${JSON.stringify(readCatalogVersion(catalog, "vitest"))}`,
      "",
    ].join("\n"),
  );
}

function rewriteDependencyField(dependencies, catalog) {
  if (dependencies === undefined) {
    return undefined;
  }

  const rewritten = {};

  for (const [name, range] of Object.entries(dependencies)) {
    rewritten[name] = range === "catalog:" ? readCatalogVersion(catalog, name) : range;
  }

  return rewritten;
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

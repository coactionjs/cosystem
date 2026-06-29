#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
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
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

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

  console.log(`Verified installed tarball builds for ${buildableExamples.length} example app(s).`);
} finally {
  await rm(tempDir, { force: true, recursive: true });
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

#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");

const publicPackages = await readPublicPackages();

for (const pkg of publicPackages) {
  const pack = await readPackManifest(pkg);
  const files = new Map(pack.files.map((file) => [file.path, file]));
  const required = await getRequiredPackageFiles(pkg);

  for (const path of required) {
    if (!files.has(path)) {
      throw new Error(`${pkg.packageJson.name} tarball is missing ${path}.`);
    }
  }

  for (const file of pack.files) {
    assertPublishableFile(pkg, file.path);
  }

  assertBinModes(pkg, files);
}

console.log(`Verified npm pack contents for ${publicPackages.length} public package(s).`);

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

async function readPackManifest(pkg) {
  const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkg.dir,
    maxBuffer: 1024 * 1024 * 10,
  });
  const entries = readPackEntries(JSON.parse(stdout));

  if (entries.length !== 1) {
    throw new Error(`${pkg.packageJson.name} pack output must contain exactly one manifest.`);
  }

  const [pack] = entries;

  if (pack.name !== pkg.packageJson.name || pack.version !== pkg.packageJson.version) {
    throw new Error(`${pkg.packageJson.name} pack identity does not match package.json.`);
  }

  if (!Array.isArray(pack.files) || pack.files.length === 0) {
    throw new Error(`${pkg.packageJson.name} pack output did not include files.`);
  }

  return pack;
}

function readPackEntries(output) {
  // npm 11 and older print an array of manifests; npm 12 prints an object keyed by package name.
  if (Array.isArray(output)) {
    return output;
  }

  if (output === null || typeof output !== "object") {
    return [];
  }

  return Object.values(output);
}

async function getRequiredPackageFiles(pkg) {
  const required = new Set(["package.json"]);

  if (await fileExists(join(pkg.dir, "README.md"))) {
    required.add("README.md");
  }

  for (const target of getExportTargets(pkg)) {
    required.add(normalizePackagePath(target));
  }

  for (const relativePath of getBinTargets(pkg)) {
    required.add(normalizePackagePath(relativePath));
  }

  return required;
}

function getExportTargets(pkg) {
  const exportsMap = pkg.packageJson.exports;

  if (exportsMap === undefined || typeof exportsMap !== "object" || Array.isArray(exportsMap)) {
    throw new Error(`${pkg.packageJson.name} must expose an exports map.`);
  }

  const targets = [];

  for (const [subpath, value] of Object.entries(exportsMap)) {
    if (typeof value === "string") {
      targets.push(value);
      continue;
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${pkg.packageJson.name} export ${subpath} must be a string or object.`);
    }

    for (const condition of ["import", "types"]) {
      if (typeof value[condition] !== "string") {
        throw new Error(`${pkg.packageJson.name} export ${subpath} is missing ${condition}.`);
      }

      targets.push(value[condition]);
    }
  }

  return targets;
}

function getBinTargets(pkg) {
  const bin = pkg.packageJson.bin;

  if (bin === undefined) {
    return [];
  }

  if (typeof bin === "string") {
    return [bin];
  }

  if (bin === null || typeof bin !== "object" || Array.isArray(bin)) {
    throw new Error(`${pkg.packageJson.name} bin must be a string or object.`);
  }

  return Object.values(bin).map((value) => {
    if (typeof value !== "string") {
      throw new Error(`${pkg.packageJson.name} bin entries must be strings.`);
    }

    return value;
  });
}

function assertPublishableFile(pkg, path) {
  if (path.endsWith(".tsbuildinfo")) {
    throw new Error(`${pkg.packageJson.name} tarball must not include ${path}.`);
  }

  if (path.startsWith(".turbo/") || path.startsWith("coverage/")) {
    throw new Error(`${pkg.packageJson.name} tarball must not include generated file ${path}.`);
  }

  if (path.startsWith("src/")) {
    throw new Error(`${pkg.packageJson.name} tarball must not include source file ${path}.`);
  }
}

function assertBinModes(pkg, files) {
  for (const relativePath of getBinTargets(pkg)) {
    const path = normalizePackagePath(relativePath);
    const file = files.get(path);

    if (file === undefined) {
      continue;
    }

    if ((file.mode & 0o111) === 0) {
      throw new Error(`${pkg.packageJson.name} bin ${path} must be executable.`);
    }
  }
}

function normalizePackagePath(path) {
  return path.startsWith("./") ? path.slice(2) : path;
}

async function fileExists(path) {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

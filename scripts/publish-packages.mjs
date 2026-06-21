#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const publishDir = join(rootDir, ".publish");
const registry = normalizeRegistry(
  process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org/",
);
const dryRun = process.argv.includes("--dry-run");
const releaseTag = process.env.NPM_TAG ?? (await readPrereleaseTag()) ?? "latest";

const publishablePackages = sortPackages(await readWorkspacePackages());
const published = [];
const skipped = [];

await rm(publishDir, { force: true, recursive: true });
await mkdir(publishDir, { recursive: true });

for (const pkg of publishablePackages) {
  const spec = `${pkg.name}@${pkg.version}`;
  if (await isPublished(spec)) {
    skipped.push(spec);
    console.log(`${spec} already exists on npm; skipping.`);
    continue;
  }

  if (dryRun) {
    console.log(`[dry-run] would publish ${spec} with tag "${releaseTag}".`);
    continue;
  }

  const tarball = await packPackage(pkg);
  await publishPackage(tarball);
  published.push(spec);
}

if (published.length > 0) {
  console.log(`Published ${published.length} package(s): ${published.join(", ")}`);
} else {
  console.log("No unpublished packages found.");
}

if (skipped.length > 0) {
  console.log(`Skipped ${skipped.length} already-published package(s).`);
}

function normalizeRegistry(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readPrereleaseTag() {
  const prePath = join(rootDir, ".changeset", "pre.json");
  if (!existsSync(prePath)) {
    return undefined;
  }

  const pre = JSON.parse(await readFile(prePath, "utf8"));
  return typeof pre.tag === "string" && pre.tag.length > 0 ? pre.tag : undefined;
}

async function readWorkspacePackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const workspacePackages = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(packagesDir, entry.name);
    const packageJsonPath = join(dir, "package.json");
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (packageJson.private === true) {
      continue;
    }

    workspacePackages.push({
      dir,
      localDependencyNames: getDependencyNames(packageJson),
      name: packageJson.name,
      version: packageJson.version,
    });
  }

  return workspacePackages;
}

function getDependencyNames(packageJson) {
  const names = new Set();
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];
    if (!dependencies) {
      continue;
    }

    for (const name of Object.keys(dependencies)) {
      names.add(name);
    }
  }

  return names;
}

function sortPackages(workspacePackages) {
  const byName = new Map(workspacePackages.map((pkg) => [pkg.name, pkg]));
  const visiting = new Set();
  const visited = new Set();
  const sorted = [];

  const visit = (pkg) => {
    if (visited.has(pkg.name)) {
      return;
    }

    if (visiting.has(pkg.name)) {
      throw new Error(`Circular local package dependency detected at ${pkg.name}.`);
    }

    visiting.add(pkg.name);
    for (const dependencyName of pkg.localDependencyNames) {
      const dependency = byName.get(dependencyName);
      if (dependency) {
        visit(dependency);
      }
    }

    visiting.delete(pkg.name);
    visited.add(pkg.name);
    sorted.push(pkg);
  };

  for (const pkg of workspacePackages) {
    visit(pkg);
  }

  return sorted;
}

async function isPublished(spec) {
  const result = await run("npm", ["view", spec, "version", "--registry", registry], {
    capture: true,
    allowFailure: true,
  });

  if (result.code === 0) {
    return result.stdout.trim().length > 0;
  }

  const output = `${result.stdout}\n${result.stderr}`;
  if (/E404|404 Not Found|No match found|not found/i.test(output)) {
    return false;
  }

  throw new Error(`Failed to check ${spec} on npm:\n${output.trim()}`);
}

async function packPackage(pkg) {
  const destination = join(publishDir, pkg.name.replaceAll("@", "").replaceAll("/", "__"));
  await rm(destination, { force: true, recursive: true });
  await mkdir(destination, { recursive: true });

  await run("pnpm", ["pack", "--pack-destination", destination], { cwd: pkg.dir });

  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));

  if (tarballs.length !== 1) {
    throw new Error(`Expected one tarball for ${pkg.name}, found ${tarballs.length}.`);
  }

  return join(destination, tarballs[0]);
}

async function publishPackage(tarball) {
  await run("npm", [
    "publish",
    tarball,
    "--access",
    "public",
    "--tag",
    releaseTag,
    "--registry",
    registry,
  ]);
}

async function run(command, args, options = {}) {
  const cwd = options.cwd ?? rootDir;
  const capture = options.capture === true;
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  let stdout = "";
  let stderr = "";

  if (capture) {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
  }

  const code = await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", done);
  });

  if (code !== 0 && options.allowFailure !== true) {
    const output = capture ? `\n${stdout}${stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${code}.${output}`);
  }

  return { code, stdout, stderr };
}

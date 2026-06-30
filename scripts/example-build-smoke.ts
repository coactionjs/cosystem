#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(rootDir, "examples");

const buildableExamples = await readBuildableExamples();

for (const example of buildableExamples) {
  await assertExampleBuild(example);
}

console.log(`Verified build output for ${buildableExamples.length} example app(s).`);

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
      name: packageJson.name,
    });
  }

  return examples.toSorted((left, right) => left.name.localeCompare(right.name));
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

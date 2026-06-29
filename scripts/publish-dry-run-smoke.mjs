#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const publishDir = join(rootDir, ".publish");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-publish-dry-run-"));
let cleanupPublishDir = false;

try {
  if (await pathExists(publishDir)) {
    throw new Error("Refusing to run publish dry-run smoke while .publish already exists.");
  }

  cleanupPublishDir = true;

  const publicPackages = await readPublicPackages();
  const fakeBinDir = join(tempDir, "bin");

  await mkdir(fakeBinDir, { recursive: true });
  await writeFakeNpm(join(fakeBinDir, "npm"));

  const { stdout } = await execFileAsync(
    process.execPath,
    [join(rootDir, "scripts/publish-packages.mjs"), "--dry-run"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NPM_CONFIG_REGISTRY: "https://registry.invalid/",
        PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
      },
      maxBuffer: 1024 * 1024 * 10,
    },
  );
  const plannedSpecs = parseDryRunSpecs(stdout);
  const expectedSpecs = publicPackages.map((pkg) => `${pkg.name}@${pkg.version}`);

  expectSameSet(plannedSpecs, expectedSpecs);
  assertLocalDependencyOrder(publicPackages, plannedSpecs);

  console.log(`Verified publish dry-run plan for ${plannedSpecs.length} package(s).`);
} finally {
  await rm(tempDir, { force: true, recursive: true });

  if (cleanupPublishDir) {
    await rm(publishDir, { force: true, recursive: true });
  }
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
      localDependencyNames: getLocalDependencyNames(packageJson),
      name: packageJson.name,
      version: packageJson.version,
    });
  }

  return packages;
}

function getLocalDependencyNames(packageJson) {
  const dependencyNames = new Set();

  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];

    if (dependencies === undefined) {
      continue;
    }

    for (const name of Object.keys(dependencies)) {
      if (name.startsWith("@cosystem/")) {
        dependencyNames.add(name);
      }
    }
  }

  return dependencyNames;
}

async function writeFakeNpm(path) {
  await writeFile(
    path,
    `#!/usr/bin/env node
if (process.argv[2] === "view") {
  console.error("E404 Not Found");
  process.exit(1);
}

console.error(\`Unexpected npm command: \${process.argv.slice(2).join(" ")}\`);
process.exit(2);
`,
  );
  await chmod(path, 0o755);
}

function parseDryRunSpecs(stdout) {
  const specs = [];
  const pattern = /^\[dry-run\] would publish (.+) with tag "latest"\.$/gm;

  for (const match of stdout.matchAll(pattern)) {
    specs.push(match[1]);
  }

  return specs;
}

function expectSameSet(actual, expected) {
  const actualSorted = actual.toSorted();
  const expectedSorted = expected.toSorted();

  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `Publish dry-run plan mismatch.\nExpected: ${expectedSorted.join(", ")}\nActual: ${actualSorted.join(", ")}`,
    );
  }
}

function assertLocalDependencyOrder(publicPackages, plannedSpecs) {
  const indexByPackage = new Map();

  for (const [index, spec] of plannedSpecs.entries()) {
    indexByPackage.set(spec.slice(0, spec.lastIndexOf("@")), index);
  }

  for (const pkg of publicPackages) {
    const pkgIndex = indexByPackage.get(pkg.name);

    for (const dependencyName of pkg.localDependencyNames) {
      const dependencyIndex = indexByPackage.get(dependencyName);

      if (dependencyIndex !== undefined && dependencyIndex > pkgIndex) {
        throw new Error(`${pkg.name} is planned before local dependency ${dependencyName}.`);
      }
    }
  }
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

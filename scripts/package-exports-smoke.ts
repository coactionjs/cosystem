#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(rootDir, "packages");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-package-exports-"));
const tscBin = join(rootDir, "node_modules/.bin/tsc");

try {
  const packages = await readPublicPackages();
  const specifiers = [];

  await mkdir(join(tempDir, "node_modules", "@cosystem"), { recursive: true });

  for (const pkg of packages) {
    await symlinkPackage(pkg);

    for (const entry of getExportEntries(pkg)) {
      await assertFileExists(pkg, entry.importPath, "import");
      await assertFileExists(pkg, entry.typesPath, "types");
      specifiers.push(entry.specifier);
    }

    await assertBinFilesExist(pkg);
  }

  await writeConsumerProject(specifiers);
  await run(tscBin, ["-p", "tsconfig.json"]);
  await run(process.execPath, ["runtime.mjs"]);

  console.log(
    `Verified ${specifiers.length} public export(s) across ${packages.length} package(s).`,
  );
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
    const packageJsonPath = join(dir, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

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

function getExportEntries(pkg) {
  const exportsMap = pkg.packageJson.exports;

  if (exportsMap === undefined || typeof exportsMap !== "object" || Array.isArray(exportsMap)) {
    throw new Error(`${pkg.packageJson.name} must expose an exports map.`);
  }

  return Object.entries(exportsMap).map(([subpath, target]) => {
    const importPath = readExportTarget(pkg, subpath, target, "import");
    const typesPath = readExportTarget(pkg, subpath, target, "types");
    const specifier =
      subpath === "." ? pkg.packageJson.name : `${pkg.packageJson.name}/${subpath.slice(2)}`;

    return {
      importPath,
      specifier,
      typesPath,
    };
  });
}

function readExportTarget(pkg, subpath, target, condition) {
  if (typeof target === "string") {
    return target;
  }

  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    throw new Error(`${pkg.packageJson.name} export ${subpath} must be a string or object.`);
  }

  const value = target[condition];

  if (typeof value !== "string") {
    throw new Error(`${pkg.packageJson.name} export ${subpath} is missing ${condition}.`);
  }

  return value;
}

async function symlinkPackage(pkg) {
  const scopeDir = join(tempDir, "node_modules", "@cosystem");
  const packageName = pkg.packageJson.name.split("/").at(-1);

  await symlink(pkg.dir, join(scopeDir, packageName), "dir");
}

async function assertFileExists(pkg, relativePath, condition) {
  const filePath = join(pkg.dir, relativePath);

  try {
    await access(filePath, constants.R_OK);
  } catch {
    throw new Error(`${pkg.packageJson.name} ${condition} target does not exist: ${relativePath}`);
  }
}

async function assertBinFilesExist(pkg) {
  const bin = pkg.packageJson.bin;

  if (bin === undefined) {
    return;
  }

  const entries = typeof bin === "string" ? [["bin", bin]] : Object.entries(bin);

  for (const [name, relativePath] of entries) {
    if (typeof relativePath !== "string") {
      throw new Error(`${pkg.packageJson.name} bin ${name} must be a string.`);
    }

    await assertFileExists(pkg, relativePath, `bin ${name}`);
  }
}

async function writeConsumerProject(specifiers) {
  await writeFile(
    join(tempDir, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(tempDir, "tsconfig.json"),
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
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(tempDir, "index.ts"), createTypeConsumerSource(specifiers));
  await writeFile(join(tempDir, "runtime.mjs"), createRuntimeConsumerSource(specifiers));
}

function createTypeConsumerSource(specifiers) {
  const imports = specifiers.map((specifier, index) => {
    return `import * as export${index} from ${JSON.stringify(specifier)};`;
  });
  const modules = specifiers.map((_specifier, index) => `export${index}`);

  return `${imports.join("\n")}\n\nconst modules = [${modules.join(", ")}] as const;\nvoid modules;\n`;
}

function createRuntimeConsumerSource(specifiers) {
  return `const specifiers = ${JSON.stringify(specifiers, null, 2)};
const modules = await Promise.all(specifiers.map((specifier) => import(specifier)));

for (let index = 0; index < modules.length; index += 1) {
  if (Object.keys(modules[index]).length === 0) {
    throw new Error(\`No runtime exports found for \${specifiers[index]}.\`);
  }
}
`;
}

async function run(command, args) {
  try {
    await execFileAsync(command, args, {
      cwd: tempDir,
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

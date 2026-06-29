#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(rootDir, "packages/create/dist/cli.mjs");
const corePackageDir = join(rootDir, "packages/core");
const tempDir = await mkdtemp(join(tmpdir(), "cosystem-create-runtime-"));
const appName = "runtime-demo";
const appDir = join(tempDir, appName);

try {
  const createResult = await run(process.execPath, [cliPath, appName], tempDir);
  const createdPath = createResult.stdout.trim().replace("Created CoSystem project at ", "");
  const [actualAppDir, reportedAppDir] = await Promise.all([
    realpath(appDir),
    realpath(createdPath),
  ]);

  if (reportedAppDir !== actualAppDir) {
    throw new Error(`create-cosystem CLI printed unexpected output:\n${createResult.stdout}`);
  }

  await mkdir(join(appDir, "node_modules", "@cosystem"), { recursive: true });
  await symlink(corePackageDir, join(appDir, "node_modules", "@cosystem/core"), "dir");

  const runResult = await run(process.execPath, ["src/main.ts"], appDir);

  if (!runResult.stdout.includes("{ counter: { count: 1 } }")) {
    throw new Error(`Generated project printed unexpected output:\n${runResult.stdout}`);
  }

  console.log("Verified generated project runtime execution.");
} finally {
  await rm(tempDir, { force: true, recursive: true });
}

async function run(command, args, cwd) {
  try {
    return await execFileAsync(command, args, {
      cwd,
      maxBuffer: 1024 * 1024,
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

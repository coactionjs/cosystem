import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createCosystemProject } from "./index.js";

const roots: string[] = [];
const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("create package", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("scaffolds a minimal CoSystem project", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosystem-create-"));
    roots.push(root);

    const result = await createCosystemProject({
      name: "demo",
      root,
    });

    expect(result.files).toEqual(["package.json", "tsconfig.json", "src/main.ts"]);
    await expect(readFile(join(root, "package.json"), "utf8")).resolves.toContain(
      '"type": "module"',
    );
    await expect(readFile(join(root, "package.json"), "utf8")).resolves.toContain(
      '"packageManager": "pnpm@11.8.0"',
    );
    await expect(readFile(join(root, "tsconfig.json"), "utf8")).resolves.toContain(
      '"skipLibCheck": true',
    );
    await expect(readFile(join(root, "src/main.ts"), "utf8")).resolves.toContain("createApp");
  });

  it("generates a project entrypoint that typechecks against the current core package", async () => {
    const root = await mkdtemp(join(tmpdir(), "cosystem-create-e2e-"));
    roots.push(root);
    await createCosystemProject({
      name: "demo",
      root,
    });
    await writeFile(
      join(root, "tsconfig.e2e.json"),
      `${JSON.stringify(
        {
          extends: "./tsconfig.json",
          compilerOptions: {
            baseUrl: ".",
            ignoreDeprecations: "6.0",
            lib: ["DOM", "ESNext"],
            noEmit: true,
            paths: {
              "@cosystem/core": [join(repoRoot, "packages/core/src/index.ts")],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      execFileAsync(join(repoRoot, "node_modules/.bin/tsc"), ["-p", "tsconfig.e2e.json"], {
        cwd: root,
      }),
    ).resolves.toMatchObject({
      stderr: "",
      stdout: "",
    });
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createCosystemProject } from "./index.js";

const roots: string[] = [];

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
      '"packageManager": "pnpm@11.8.0"',
    );
    await expect(readFile(join(root, "src/main.ts"), "utf8")).resolves.toContain("createApp");
  });
});

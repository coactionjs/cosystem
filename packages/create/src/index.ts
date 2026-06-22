import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CreateCosystemProjectOptions {
  readonly root: string;
  readonly name: string;
  readonly packageManager?: string;
}

export interface CreatedCosystemProject {
  readonly root: string;
  readonly files: readonly string[];
}

export async function createCosystemProject(
  options: CreateCosystemProjectOptions,
): Promise<CreatedCosystemProject> {
  const packageManager = options.packageManager ?? "pnpm@11.8.0";
  const files = ["package.json", "tsconfig.json", "src/main.ts"] as const;

  await mkdir(join(options.root, "src"), { recursive: true });
  await writeFile(
    join(options.root, "package.json"),
    `${JSON.stringify(createPackageJson(options.name, packageManager), null, 2)}\n`,
  );
  await writeFile(
    join(options.root, "tsconfig.json"),
    `${JSON.stringify(createTsConfig(), null, 2)}\n`,
  );
  await writeFile(join(options.root, "src/main.ts"), createMainSource());

  return {
    files,
    root: options.root,
  };
}

function createPackageJson(name: string, packageManager: string): object {
  return {
    name,
    private: true,
    type: "module",
    scripts: {
      build: "tsc -p tsconfig.json",
      start: "tsx src/main.ts",
    },
    dependencies: {
      "@cosystem/core": "latest",
    },
    devDependencies: {
      tsx: "latest",
      typescript: "latest",
    },
    packageManager,
  };
}

function createTsConfig(): object {
  return {
    compilerOptions: {
      module: "NodeNext",
      moduleResolution: "NodeNext",
      skipLibCheck: true,
      strict: true,
      target: "ES2022",
    },
    include: ["src/**/*.ts"],
  };
}

function createMainSource(): string {
  return `import { createApp, defineModule } from "@cosystem/core";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "counter",
  state: ["count"],
});

const app = createApp({
  providers: [Counter],
});

const counter = app.getModule(Counter);
counter.increase();

console.log(app.store.getPureState());
`;
}

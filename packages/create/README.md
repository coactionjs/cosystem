# @cosystem/create

> Project scaffolding for [CoSystem](../../README.md). Ships the
> `create-cosystem` CLI and a programmatic `createCosystemProject()` API that
> generate a minimal `@cosystem/core` starter.

## Usage

Scaffold a new project with your package manager's `create`/`dlx` command — no
global install required:

```sh
pnpm dlx @cosystem/create my-app
# npm exec @cosystem/create -- my-app
# yarn dlx @cosystem/create my-app

cd my-app
pnpm install
pnpm start
```

The target directory defaults to `cosystem-app` when no name is given. The
generated project contains:

```text
my-app/
├── package.json     # scripts: build (tsc), start (tsx src/main.ts)
├── tsconfig.json    # strict, NodeNext, ES2022
└── src/
    └── main.ts      # a defineModule() counter wired into createApp()
```

`src/main.ts` is a runnable starting point:

```ts
import { createApp, defineModule } from "@cosystem/core";

class Counter {
  count = 0;
  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, { actions: ["increase"], name: "counter", state: ["count"] });

const app = createApp({ providers: [Counter] });
app.getModule(Counter).increase();
console.log(app.store.getPureState());
```

## Programmatic API

```ts
import { createCosystemProject } from "@cosystem/create";

const result = await createCosystemProject({
  root: "/abs/path/to/my-app",
  name: "my-app",
  packageManager: "pnpm@11.8.0", // optional
});

console.log(result.files); // ["package.json", "tsconfig.json", "src/main.ts"]
```

| Option           | Type     | Description                                     |
| ---------------- | -------- | ----------------------------------------------- |
| `root`           | `string` | Absolute directory to generate into.            |
| `name`           | `string` | Project name written to `package.json`.         |
| `packageManager` | `string` | `packageManager` field (default `pnpm@11.8.0`). |

Returns `{ root, files }`.

## Exports

CLI bin `create-cosystem`; module exports `createCosystemProject` and the
`CreateCosystemProjectOptions`, `CreatedCosystemProject` types.

## License

[MIT](../../LICENSE) © Coaction

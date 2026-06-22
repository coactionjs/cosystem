# @cosystem/tsconfig

> Shared TypeScript configuration for the [CoSystem](../../README.md) monorepo.

A private, internal package (`workspace:*`) that centralizes the `tsconfig`
presets used across CoSystem packages. It is not published to npm.

## Configurations

| File           | Extends     | Intended for                                                                                                                                                            |
| -------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base.json`    | —           | Strict TypeScript foundation: `strict`, `NodeNext`, `ES2022`, `isolatedDeclarations`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. |
| `node.json`    | `base.json` | Node-targeted code (`lib: ES2023`, `types: ["node"]`).                                                                                                                  |
| `library.json` | `node.json` | Published libraries (`composite`, `declaration`).                                                                                                                       |

## Usage

Add the package as a dev dependency in a workspace package and extend a preset:

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@cosystem/tsconfig/library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
  },
  "include": ["src"],
}
```

```jsonc
// devDependencies
{
  "@cosystem/tsconfig": "workspace:*",
}
```

## Exports

The package exposes `./base.json`, `./node.json`, and `./library.json` via its
`exports` map.

## License

[MIT](../../LICENSE) © Coaction

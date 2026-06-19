# cosystem

CoSystem - The meta-framework for coexisting UI frameworks.

## Tooling

This repository is set up as a modern TypeScript monorepo:

- pnpm workspaces with strict catalog-managed dependency versions
- Turborepo task orchestration
- Oxlint and Oxfmt for fast linting and formatting
- Vitest projects with V8 coverage
- tsdown for library builds powered by Rolldown
- Changesets for package versioning and publishing
- Commitizen, cz-git, commitlint, Husky, and lint-staged for commit hygiene

## Requirements

- Node.js `>=22.12.0`
- pnpm `11.8.0` via Corepack or a compatible global install

```sh
corepack enable pnpm
corepack use pnpm@11.8.0
pnpm install
```

## Common Commands

```sh
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check
pnpm changeset
pnpm run commit
```

## Workspace Layout

```text
apps/              # applications and services
packages/core/     # starter publishable TypeScript package
packages/tsconfig/ # shared TypeScript configuration package
```

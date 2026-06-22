# Contributing to CoSystem

Thanks for your interest in improving CoSystem! This guide covers the local
setup, the day-to-day workflow, and the conventions the repository enforces.

## Prerequisites

- **Node.js** `>=22.12.0` (CI runs on 22.x and 24.x)
- **pnpm** `11.8.0` — install it through Corepack:

  ```sh
  corepack enable pnpm
  corepack use pnpm@11.8.0
  ```

## Getting started

```sh
git clone https://github.com/coactionjs/cosystem.git
cd cosystem
pnpm install
pnpm run build   # build all packages once so cross-package types resolve
```

This is a [pnpm workspace](https://pnpm.io/workspaces) monorepo with strict,
catalog-managed dependency versions and [Turborepo](https://turbo.build/) task
orchestration. Packages live in `packages/*` and runnable demos in `examples/*`.

## Repository tooling

| Tool                              | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| pnpm workspaces + catalogs        | Dependency management with pinned versions.        |
| Turborepo                         | Task graph and caching (`build`, `test`, …).       |
| [Oxlint](https://oxc.rs/) + Oxfmt | Fast linting and formatting.                       |
| [Vitest](https://vitest.dev/)     | Unit tests with V8 coverage.                       |
| [tsdown](https://tsdown.dev/)     | Library builds powered by Rolldown.                |
| Changesets                        | Versioning and changelog generation.               |
| Commitizen / cz-git / commitlint  | Conventional commit authoring and validation.      |
| Husky + lint-staged               | Pre-commit formatting/linting and commit-msg lint. |

## Common commands

Run from the repository root:

```sh
pnpm run dev          # watch-build all packages in parallel
pnpm run build        # build all packages (turbo)
pnpm run test         # run the full Vitest suite
pnpm run test:watch   # watch mode
pnpm run typecheck    # tsc --noEmit across packages
pnpm run lint         # oxlint
pnpm run lint:fix     # oxlint --fix
pnpm run format       # oxfmt --write
pnpm run format:check # oxfmt --check
pnpm run check        # format:check + lint + typecheck + test + build (what CI runs)
```

Target a single package or example with pnpm filters:

```sh
pnpm --filter @cosystem/core test
pnpm --filter @cosystem/example-react-counter dev
```

Before opening a pull request, make sure `pnpm run check` passes — it mirrors the
CI `verify` job.

## Tests

Tests live next to the source as `*.test.ts` files and run through Vitest
workspace projects (one per package). Add or update tests for any behavior change.
For app-level tests, prefer [`@cosystem/testing`](./packages/testing)'s `testApp`,
which provides provider overrides and action/state/patch inspection.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
are validated by commitlint on commit. Use the guided prompt:

```sh
pnpm run commit
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **Scopes (preferred):** `core`, `config`, `repo`, `release`, `docs`, `ci`,
  `deps` — custom scopes are allowed but a scope is required.

Example: `docs(core): document worker transports`.

## Changesets and releases

User-facing changes need a [changeset](https://github.com/changesets/changesets)
describing the change and the semver bump for each affected package:

```sh
pnpm changeset
```

Releases are automated:

1. Merged changesets are collected into a version PR (`version-packages`).
2. Merging that PR updates versions and changelogs.
3. Pushing the resulting `v*` tag triggers the publish workflow.

You generally only need to add a changeset; the rest is handled by CI.

## Pull requests

1. Fork and branch from `main`.
2. Make your change with tests and (when user-facing) a changeset.
3. Run `pnpm run check`.
4. Open a PR with a clear description of the motivation and approach.

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).

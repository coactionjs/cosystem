# Changesets

Run `pnpm changeset` from the repository root when a package change should be released.

The generated markdown files in this directory should be committed with the code change.

## Release Flow

1. Merging package changes with changeset markdown into `main` lets the `Version Packages` workflow create or update a release PR.
2. Merging the generated release PR removes consumed changesets, bumps package versions, and triggers `Publish Packages`.
3. `Publish Packages` builds and verifies the repo, packs each unpublished workspace package with `pnpm pack`, and publishes the generated tarball with `npm publish` so npm Trusted Publisher OIDC is used.

The npm Trusted Publisher workflow filename must be configured as `publish.yml` for each public `@cosystem/*` package. If an npm Trusted Publisher environment name is configured, add the same `environment` name to the publish job in `.github/workflows/publish.yml`.

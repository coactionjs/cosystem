---
"@cosystem/core": patch
"@cosystem/angular": patch
---

Remove the unused `rxjs` peer dependency from `@cosystem/angular`.
`@cosystem/core` now builds with a neutral platform target and uses the same
`.js`/`.d.ts` output convention as the other browser-and-server packages.

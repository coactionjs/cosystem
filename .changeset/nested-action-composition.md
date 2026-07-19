---
"@cosystem/core": patch
---

Support nested and cross-module action composition. Actions invoked while
another action is running now reuse the open root draft instead of calling
`setState` again, which Coaction rejects while a commit is open. Cross-module
state writes inside an action are routed into the active commit and are
allowed under `strictActions`. Everything inside the outermost action merges
into a single commit: one state notification and one patch set, rolled back
as a whole if the outermost action throws.

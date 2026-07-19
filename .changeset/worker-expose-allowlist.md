---
"@cosystem/core": patch
---

Allow worker hosts to opt ordinary module methods into remote invocation with
the new `createWorkerApp({ expose })` allowlist. Declared module actions remain
remotely callable by default; lifecycle hooks, helpers, and other methods stay
private unless explicitly listed by module name.

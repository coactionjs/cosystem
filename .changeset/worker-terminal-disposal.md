---
"@cosystem/core": patch
---

Abort worker app initialization before awaiting host readiness during disposal, make host disposal idempotent, and reject new client RPC calls after client disposal.

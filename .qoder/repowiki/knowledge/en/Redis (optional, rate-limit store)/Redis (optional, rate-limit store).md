---
kind: external_dependency
name: Redis (optional, rate-limit store)
slug: redis-ioredis
category: external_dependency
category_hints:
    - vendor_identity
    - migration_status
scope:
    - '**'
---

- Redis is wired in via `ioredis` but only as an optional shared store for the per-route rate limiter. When `RATE_LIMIT_STORE=redis` the limiter connects to `REDIS_URL`; if Redis is unreachable it falls back to an in-process Map so the server never hard-fails.
- In local dev the default fallback is `redis://localhost:6379`; in Dokploy it should point to the internal managed Redis service.
- Redis is not yet used for sessions or caching — those helpers become no-ops when Redis is disabled.
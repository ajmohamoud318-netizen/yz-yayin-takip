# YZ Yayın Takip — Internal Publication Tracker

> **Canonical documentation lives in [AGENTS.md](AGENTS.md).**
> This file is kept as a thin pointer; the product description, pipelines,
> architecture, file structure, database schema, API endpoints, and conventions
> are all documented in `AGENTS.md`. If you change one, change the other.
> See `PASSES.md` for the discovery notes that drove the current pass design.

---
## One-paragraph summary

YZ Yayın Takip is an internal book-publishing pipeline tracker for Yükselen
Zeka: React + Vite SPA on top of a Fastify + Postgres 16 backend (`server/`),
talking to the API via Axios (`client/src/infrastructure/http/`). A mock
in-browser repository layer still exists behind a `USE_MOCK` switch but is
off by default — the SPA runs against the real Fastify server. Auth in this
pass is a trusted `X-User-Id` header; real OAuth+cookie sessions are the
next pass (see AGENTS.md's Production Checklist for what's still open).
---
## 🏢 What This Is
YZ Yayın Takip replaces analog/Excel workflows with a unified dashboard where the team leader (Ayşenur) can see every book project, who is working on what, and what stage it's in — in real time. It also covers the post-production side: a sales-reprint (sipariş) workflow, a physical handover (teslim) flow, and a read-only product catalog for the sales team.

**Roles (4):** `team_leader` (Ayşenur), `designer` (Aylin, Feyza, Nur, Sümeyye), `printer` / Matbaa (Oktay, Atilla), `satis` / Sales (Esra). Full responsibilities, pipelines (TR/ÇİN), the sipariş and teslim mini-workflows, the production gate, the demo hold/re-send rules, dashboard views, user management, DB schema, API endpoints, conventions, and the deploy story are all in **AGENTS.md** — do not duplicate them here. If a rule described in AGENTS.md changes, edit AGENTS.md, not this file.

The backend (Fastify + Postgres 16, `server/`) is built and live — not a future/planned component. See AGENTS.md's "🚀 Production Checklist" for exactly what's shipped vs. still open (OAuth, Redis sessions, rate limiting are the main gaps).

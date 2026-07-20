# YZ Yayın Takip — Internal Publication Tracker

> **Canonical documentation lives in [AGENTS.md](AGENTS.md).**
> This file is kept as a thin pointer; the product description, pipelines,
> architecture, file structure, database schema, API endpoints, and conventions
> are all documented in `AGENTS.md`. If you change one, change the other.
> See `PASSES.md` for the discovery notes that drove the current pass design.

---
## One-paragraph summary

YZ Yayın Takip is an internal book-publishing pipeline tracker for Yükselen
Zeka. Frontend React + Vite SPA + Fastify + Postgres backend. The SPA talks
to the API directly via Axios (`client/src/infrastructure/http/`) — there is
no mock layer or in-browser data store. Auth in this pass is a trusted
`X-User-Id` header; real OAuth+cookie sessions arrive next pass.
---
## 🏢 What This Is
YZ Yayın Takip replaces analog/Excel workflows with a unified dashboard where the team leader (Ayşenur) can see every book project, who is working on what, and what stage it's in — in real time. It also tracks reprint/production **orders (sipariş)** raised by the Sales team and the physical **handover (teslim)** of produced materials.

**Roles (4):**
- **Ayşenur (team_leader)** — creates projects, assigns designers, approves/rejects at every stage, manages team members, and owns key steps of the order (sipariş) workflow
- **Designer (designer)** — works on assigned projects, checks off subtasks, submits demos; also confirms order requests routed to them
- **Oktay (printer / "Matbaa")** — approves Demo and Özalit stages for TR projects, marks production-ready items, raises handover (teslim) requests, and handles the matbaa steps of the order workflow
- **Atilla (printer / "Matbaa")** — second Matbaa user, same responsibilities as Oktay
- **Esra (satis / Sales)** — raises order (sipariş) requests for projects that have reached Satışta, and confirms handover ("Alındı") which moves a project to Satışta
---
## 🗂️ Project Types
Every project is either **TR** or **ÇİN** — this determines which pipeline it follows.
---
## 🔄 Workflows
### TR Pipeline
```
Yeni Proje (created by Ayşenur, assigned to designer)
    ↓
Tasarım (designer checks off subtasks → progress % auto-calculated)
    ↓ at 100% → notifies Ayşenur + Oktay
Demo Teslim (designer submits demo)
    ↓
Demo Onay
    ✓ Oktay approves → Özalit
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (attempt counter +1)
    ↓
Özalit Teslim
    ↓
Özalit Onay
    ✓ Oktay approves → Üretime Hazır
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (attempt counter +1)
    ↓
Üretime Hazır
    ↓
Üretimde
    ↓
Satışta ✅ (reached when Sales confirms handover — see Handover flow)
```
### ÇİN Pipeline
```
Yeni Proje (created by Ayşenur, assigned to designer)
    ↓
Tasarım (designer checks off subtasks → progress % auto-calculated)
    ↓ at 100% → notifies Ayşenur
Çin Demo Teslim
    ↓
Çin Demo Onay
    ✓ Ayşenur approves → Üretime Hazır
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (attempt counter +1)
    ↓
Üretime Hazır
    ↓
Üretimde
    ↓
Gümrük
    ↓
Satışta ✅ (reached when Sales confirms handover — see Handover flow)
```
Stage keys (from `client/src/domain/constants/stages.js`):
```
TR:  tasarim → demo_teslim → demo_onay → ozalit_teslim → ozalit_onay → uretime_hazir → uretimde → satista
CIN: tasarim → cin_demo_teslim → cin_demo_onay → uretime_hazir → uretimde → gumruk → satista
```

### Rejection Rule
- Every rejection requires a written reason
- The reason is stored and visible on the project history
- The demo/özalit attempt counter increments on each rejection (Demo 1, Demo 2, etc.)
- Only Ayşenur (team_leader) can reject at any stage

### Order (Sipariş) Workflow — separate mini-pipeline
Raised by Sales once a project is **Satışta** (`ORDERABLE_STAGES = { satista }`). Steps and owners (`client/src/domain/constants/orders.js`):
```
pending        (Talep Gönderildi)      owner: team_leader  → aktarır
    ↓
goruldu        (Tasarımcıya Aktarıldı) owner: designer     → onaylar
    ↓
tasarimci_onay (Tasarımcı Onayı)       owner: printer      → matbaa teslim
    ↓
matbaa_onay    (Matbaa Teslimi)        owner: team_leader  → onaylar
    ↓
onaylandi      (Üretime Alındı) ✅
```
Rejection: team_leader can reject at `matbaa_onay`, looping back to `tasarimci_onay` (özalit attempt counter +1, reason required).

### Handover (Teslim) Flow
- **Matbaa (printer)** raises a handover request for a project whose production is finished (TR: `uretimde`, ÇİN: `gumruk`). One pending request per project.
- **Sales (satis)** confirms receipt ("Alındı") → this is the **only path that moves a project to Satışta**.
---
## 📊 Dashboard View
**Grouping labels (not pipeline stages):**
- **Yeni Proje** — created by Ayşenur, designer has not started yet
- **Devam Eden Proje** — designer has started (Tasarım stage is active)

**Main dashboard shows:** monthly timeline view, project cards (current stage, assigned designer(s), progress %), color-coded by status. Additional views exist: Kanban (İş Akışı), Yıl Planı, Tüm Projeler, Dökümanlar, Ürün Bilgileri, and role-specific sipariş/teslim screens.
---
## 👥 User Management
- Only Ayşenur can add / deactivate team members
- When adding a user: name + email + role (designer, printer, or satis)
- Deactivated users lose access immediately but their project history is preserved
- Roles: `team_leader` | `designer` | `printer` | `satis`
- Role display labels (`client/src/domain/constants/labels.js`): Takım Lideri, Tasarımcı, Matbaa, Satış Ekibi
> Note: the invitation email / set-password flow is implemented by the Fastify
> backend in `server/src/routes/auth.js`. The SPA renders the link in
> `pages/AcceptInvite.jsx`; users are seeded on first boot via
> `server/db/seed/users.js`.
---
## 📋 Project Subtasks
When creating a project, Ayşenur selects which subtasks apply: Kapak, Kutu, Ses, Video / Animasyon, Yazılım, İçerik / Görsel, Sayfa Sayısı (numeric). Each subtask can be checked off by the designer. Progress % = completed subtasks / total subtasks × 100 (recalculated in `client/src/domain/services/progress.js`).
---
## 🖥️ UI Views by Role
| Role         | Default landing           | Can do                                                              |
|--------------|---------------------------|--------------------------------------------------------------------|
| team_leader  | Dashboard                 | Everything — create, assign, approve, reject, manage team, order steps |
| designer     | My Projects (Projelerim)  | See assigned projects, check subtasks, submit demo, confirm routed orders |
| printer      | Approvals / Üretime Hazır | Approve Demo/Özalit (TR), mark production-ready, raise handovers, matbaa order steps |
| satis        | Sipariş Talebi            | Raise order requests (Satışta projects), confirm handovers ("Alındı") |

Route guards live in `client/src/App.jsx` (`RoleGuard`); navigation per role in `client/src/components/AppShell.jsx`.
---
## 🏗️ Current Architecture
```
[React + Vite SPA] ──▶ [Fastify REST API] ──▶ [PostgreSQL]
        │                       │                       │
        │                ┌──────┼──────┐           [Redis]
        │            [Email]  [Notifications]   (planned: sessions, cache, pub-sub)
        └── (in dev: /api proxy → http://localhost:4000)
```
- **Frontend (`client/`)** — React + Vite SPA. Talks to the backend via
  Axios (`client/src/infrastructure/http/`). Business logic lives in
  `client/src/domain/` (pure) and `client/src/application/` (use-cases +
  composition root). Auth is currently a trusted `X-User-Id` header; real
  httpOnly cookie sessions are the next pass.
- **Backend (`server/`)** — Fastify + Postgres 16 + `bcryptjs` +
  Nodemailer. See `DEPLOY.md` for the Dokploy deploy story.
- **No mock layer exists** in this pass — all data flows through the real
  Fastify server. `client/src/infrastructure/shared/` holds the cross-aggregate
  error helpers (`badRequest`, `notFound`, …) used by both repositories and
  use cases.

**Tech stack (current):**
| Layer        | Choice                          |
|--------------|---------------------------------|
| Frontend     | React + Vite                    |
| UI / Icons   | shadcn/ui + Tailwind            |
| HTTP         | Axios (`client/src/infrastructure/http/client.js`) |
| Backend      | Fastify + Node 20               |
| Database     | PostgreSQL 16                   |
| Email        | Nodemailer → Resend SMTP        |
---
## 📐 Conventions
- Frontend: functional components + hooks only; shadcn/ui for all UI primitives
- Business rules live in `domain/` (pure, testable) — do not hardcode stage/role logic in components
- Data access goes through `application/` use-cases and `infrastructure/` repositories, never directly
- Stage transitions go through use-cases (advance / approve / reject) — never mutate `stage` directly
- Progress % recalculated on every subtask change
- Rejection always requires a `reason`
- Dates: handled as ISO UTC, displayed `tr-TR` locale
- Order/handover logic is separate from the main project pipeline (`domain/constants/orders.js`, `application/use-cases/orders`, `application/use-cases/handovers`)
---
## 🚧 Backend — Planned / Future Work
> **Not built yet. This is the target design for after the frontend is finished.** The frontend's `infrastructure/http` layer is already stubbed to talk to it.

**Planned stack:** Node.js + Fastify · PostgreSQL · Redis (sessions/cache/pub-sub) · Google OAuth · Nodemailer (invites + notifications) · Railway/Render hosting.

**Planned API (subject to change — must also cover the order & handover workflows the frontend already implements):**
```
Auth:      GET /api/auth/google, /callback · POST /api/auth/logout · GET /api/auth/me
Projects:  GET /api/projects · GET /api/projects/:id · POST/PATCH/DELETE (team_leader)
Stages:    POST /api/projects/:id/advance | /approve | /reject
Subtasks:  PATCH /api/subtasks/:id
Users:     GET /api/users · POST /api/users/invite · PATCH /:id/deactivate | /reactivate
Orders:    (sipariş) create / advance / reject  — mirrors client use-cases
Handovers: (teslim) create / confirm            — mirrors client use-cases
```

**Planned DB schema (base — will also need `orders`, `order_history`, and `handovers` tables):**
```sql
-- users: id, name, email, password (null until invite accepted),
--        role CHECK IN ('team_leader','designer','printer','satis'),
--        is_active, invited_at, joined_at, created_at
-- projects: id, title, type CHECK IN ('TR','CIN'),
--           stage CHECK IN ('tasarim','demo_teslim','demo_onay','ozalit_teslim',
--             'ozalit_onay','cin_demo_teslim','cin_demo_onay',
--             'uretime_hazir','uretimde','gumruk','satista'),
--           assigned_to, created_by, target_month, demo_attempt, progress,
--           created_at, updated_at
-- subtasks: id, project_id, title, is_done, done_at
-- stage_history: id, project_id, from_stage, to_stage,
--                action CHECK IN ('advance','approve','reject'), reason, done_by, created_at
-- invitations: id, user_id, token, expires_at, used_at
-- orders / order_history / handovers: TBD to match domain/constants/orders.js
```

**Production checklist (for when backend work starts):** register Google OAuth app · httpOnly/sameSite=strict/secure cookies · Redis session TTL 7d w/ refresh · role middleware on every route · Fastify JSON-schema validation on all POST/PATCH · Redis rate limiting on auth · invite-via-allowlist flow · file upload type/size validation · `.env` never committed · CORS locked to prod domain · DB pool max 10 · Redis retry/reconnect.

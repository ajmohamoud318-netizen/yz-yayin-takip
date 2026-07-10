# YZ Yayın Takip — Internal Publication Tracker
> Production-ready MVP for Yükselen Zeka's internal book publishing pipeline
---
## 🏢 What This Is
YZ Yayın Takip replaces analog/Excel workflows with a unified dashboard where the team leader (Ayşenur) can see every book project, who is working on what, and what stage it's in — in real time. It also covers the **post-production side**: a sales-reprint (sipariş) workflow, a physical handover ("teslim") flow, and a read-only product catalog for the sales team.

The frontend follows a **Clean Architecture** layout (`client/ARCHITECTURE.md`): Presentation → `api.js` facade → Application (use-cases) → Domain (pure rules) ← Infrastructure (mock today, HTTP tomorrow).

---
## 👥 Roles
The app has **4 roles** — `satis` (Satış Ekibi) was added on top of the original three and runs the sales order / handover side of the business.

| Role | Turkish | Real user(s) | Default landing |
|---|---|---|---|
| `team_leader` | Takım Lideri | Ayşenur Kanak | Dashboard (`/`) |
| `designer` | Tasarımcı | Aylin Ulu, Feyza Küçükkurt, Nur Ekincioğlu, Sümeyye Arslantürk | My Projects (`/my-projects`) |
| `printer` | Matbaa | Oktay Şahin | Onaylar (`/approvals/demo`) |
| `satis` | Satış Ekibi | Esra Kılıç | Sipariş Talebi (`/siparis-talebi`) |

> `HomeRedirect` in `App.jsx` specifically sends `satis` users from `/` → `/siparis-talebi`.

---
## 🗂️ Project Types
Every project is either **TR** or **ÇİN** — this determines which pipeline it follows and whether it goes through Gümrük (customs).
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
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (demo_attempt +1)
    ↓
Özalit Teslim
    ↓
Özalit Onay
    ✓ Oktay approves → Üretime Hazır
    ✗ Ayşenur rejects (reason REQUIRED, target = matbaa|designer) → back to Tasarım (ozalit_attempt +1)
    ↓
Üretime Hazır
    ↓
Üretimde
    ↓
Satışta ✅  (matbaa raises teslim → sales confirms Alındı)
```
### ÇİN Pipeline
```
Yeni Proje (created by Ayşenur, assigned to designer)
    ↓
Tasarım (designer checks off subtasks)
    ↓ at 100% → notifies Ayşenur
Çin Demo Teslim
    ↓
Çin Demo Onay
    ✓ Ayşenur approves → Üretime Hazır
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (demo_attempt +1)
    ↓
Üretime Hazır
    ↓
Üretimde
    ↓
Gümrük
    ↓
Satışta ✅
```
### Production Gate
A project **cannot** enter Ozalit or any later stage until `progress === 100%`. Enforced by `assertCanEnterProduction` in `domain/services/pipeline.js`. `STAGES_REQUIRING_FULL_PROGRESS` = `ozalit_teslim, ozalit_onay, uretime_hazir, uretimde, gumruk, satista`.

### Rejection Rule (main pipeline)
- Every rejection requires a written `reason` (backend-enforced)
- The reason is stored in `stage_history` and visible on the project history
- The `demo_attempt` / `ozalit_attempt` counter increments on each rejection (Demo 1, Demo 2, …)
- Only `team_leader` can reject at any stage
- At Özalit rejection, the leader picks the loop target: `matbaa` (Matbaa re-delivers ozalit) or `designer` (Tasarımcı reworks first)

---
## 🛒 Sipariş (Order) Mini-Workflow — sales re-prints
Separate from the main pipeline. Satış Ekibi raises an order for a project that has already reached `satista`; the project cycles through the team, designer, and matbaa again. Defined in `client/src/domain/constants/orders.js`.

```
pending (team_leader)        Talep Gönderildi
   ↓ team_leader advances
goruldu (designer)           Tasarımcıya Aktarıldı
   ↓ designer confirms work
tasarimci_onay (printer)     Tasarımcı Onayı
   ↓ printer delivers ozalit
matbaa_onay (team_leader)    Matbaa Teslimi
   ↓ team_leader approves → onaylandi (üretime alındı)
onaylandi                    Üretime Alındı
```

- `ORDER_STEP_OWNER` maps each step to the role that must act on it
- `ORDER_REJECT_TARGETS.matbaa_onay` = `{ designer, matbaa }` — mirrors the main pipeline's ozalit rejection target choice
- `canRequestOrder` (and the throwing `assertOrderable`) gate the create-order use case to projects whose `stage ∈ { 'satista' }` only — `ORDERABLE_STAGES` set

---
## 📦 Teslim (Physical Handover) Workflow
When Matbaa finishes printing (`uretimde` for TR, `gumruk` for ÇİN), they raise a **handover request** so Satış can confirm the physical delivery.

- `HANDOVER_ELIGIBLE_STAGE = { TR: 'uretimde', CIN: 'gumruk' }`
- `canRequestHandover(p)` / `assertHandoverEligible(p)` guard this in `domain/services/pipeline.js`
- `printer` raises the request at `/teslim-talepleri`
- `satis` confirms "Alındı" at `/teslim-onaylari` — the project moves to `satista`
- `satis` user is alerted (green notification) when their own request reaches `onaylandi`

---
## 📊 Dashboard View
**Grouping labels (not pipeline stages):**
- **Yeni Proje** — created by Ayşenur, designer has not started yet
- **Devam Eden Proje** — designer has started (Tasarım stage is active)
**Main dashboard shows:**
- Monthly timeline view (projects mapped to target months)
- Project cards with current stage, assigned designer, progress %
- Color-coded by status (see below)
**Status colors:**
- 🟠 Orange — Yeni Proje / just started
- 🟣 Purple — Devam Eden / in progress
- 🟢 Green — Demo aşamasında
- 🔵 Blue — Özalit aşamasında
- 🩷 Pink — Üretimde
- 🟡 Yellow — Satışta

**Period widget** (sidebar): shows `satista / total` ratio with the upcoming month-end deadline.

---
## 👥 User Management
- Only `team_leader` can add / deactivate team members (route `/team` is guarded to `team_leader`)
- When adding a user: name + email + role (`designer` | `printer` | `satis`)
- Invitation flow sends an email with a link to set password at `/accept-invite`
- Deactivated users lose access immediately but their project history is preserved
- Roles: `team_leader` | `designer` | `printer` | `satis`

---
## 📋 Project Subtasks
When creating a project, the team leader selects which subtasks apply:
- Kapak (cover)
- Kutu (box)
- Ses (sound)
- Video / Animasyon
- Yazılım (software)
- İçerik / Görsel (content / visuals)
- Sayfa Sayısı (page count — numeric field)
The designer can check each one off (and add per-subtask updates / page progress). Progress % = completed subtasks / total subtasks × 100, recalculated server-side on every check.

---
## 🏗️ System Architecture
```
[React Frontend (Vite)] ──▶ [Node/Fastify REST API] ──▶ [PostgreSQL]
        │                            │                          │
        │                    ┌───────┼────────┐            [Redis]
        │                [OAuth]  [Email]  [Notifications]  (sessions, cache, pub-sub)
        │
        └── (today) uses an in-browser mock layer (localStorage) implementing
            the same repository interfaces — flip USE_MOCK=false to switch
            to the real backend.
```

**Tech Stack:**
| Layer        | Choice                  | Why                                          |
|--------------|-------------------------|----------------------------------------------|
| Frontend     | React + Vite            | Fast, component-based, easy to extend        |
| UI / Icons   | shadcn/ui + Tailwind    | Prebuilt accessible components, utility-first |
| State hooks  | Context + custom hooks  | `useProjectsStore`, `useProjectModal`, etc.  |
| Architecture | Clean Architecture      | Domain ← Application → Presentation; mock/infra behind ports |
| Backend      | Node.js + Fastify       | Faster than Express, built-in schema validation |
| Database     | PostgreSQL              | Relational, ACID, great for pipelines        |
| Cache / RT   | Redis                   | Session store, notification pub-sub, caching |
| Auth         | OAuth (Google)          | No passwords to manage, team uses Google     |
| Email        | Nodemailer              | Invitations + stage notifications            |
| Hosting      |dokploy app:**
- OAuth session storage (server-side sessions keyed by session ID)
- Rate limiting per user/IP on sensitive routes
- Real-time notification pub-sub (stage changes → push to connected clients)
- Short-lived cache for dashboard project lists (TTL: 30s)

---
## 📁 File Structure
```
yz-yayin-takip/
├── AGENTS.md
├── .env.example
├── docker-compose.yml
│
├── server/                             # (planned) Fastify backend
│   ├── index.js
│   ├── db.js                           # PostgreSQL connection pool
│   ├── redis.js                        # Redis client + helpers
│   ├── middleware/
│   │   ├── auth.js                     # OAuth session verify + role attach
│   │   └── requireRole.js              # role-based guard
│   ├── routes/
│   │   ├── auth.js                     # OAuth callback, session, logout, /me
│   │   ├── projects.js                 # CRUD + stage transitions
│   │   ├── subtasks.js                 # check/uncheck subtasks
│   │   ├── approvals.js                # approve / reject with reason
│   │   ├── orders.js                   # sipariş talep workflow
│   │   ├── handovers.js                # teslim (printer → sales)
│   │   └── users.js                    # invite, deactivate, list
│   ├── services/
│   │   ├── email.js                    # nodemailer wrapper
│   │   ├── notifications.js            # stage change notifications (Redis pub-sub)
│   │   └── session.js                  # Redis session store helpers
│   └── db/
│       ├── schema.sql
│       └── seed.sql
│
└── client/                             # React + Vite + Clean Architecture
    ├── index.html
    ├── vite.config.js
    ├── ARCHITECTURE.md                 # Layer diagram + folder map
    ├── components.json
    ├── tailwind.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx                     # Routes + RoleGuard + HomeRedirect
        ├── api.js                      # Composition-root facade
        ├── index.css
        │
        ├── domain/                     # Pure rules & types — no framework deps
        │   ├── index.js
        │   ├── constants/
        │   │   ├── labels.js           # ROLE_LABELS, TYPE_LABELS, GROUP_LABELS
        │   │   ├── stages.js           # STAGE_LABELS, STAGE_PIPELINE, ORDERABLE_STAGES, HANDOVER_ELIGIBLE_STAGE
        │   │   ├── orders.js           # ORDER_STEPS, ORDER_STEP_OWNER, ORDER_REJECT_TARGETS
        │   │   ├── subtasks.js
        │   │   └── status-styles.js
        │   └── services/
        │       ├── pipeline.js         # getPipeline, canRequestOrder, canRequestHandover, assertCanEnterProduction
        │       ├── progress.js
        │       └── project-status.js
        │
        ├── application/                # Use cases, mappers, ports
        │   ├── create-api.js          # Wires repos + use cases → api object
        │   ├── mappers/
        │   │   └── project-mapper.js
        │   ├── ports/
        │   │   └── index.js
        │   └── use-cases/
        │       ├── auth/
        │       ├── demos/
        │       ├── handovers/          # create-handover, confirm-handover
        │       ├── orders/             # create-order-request, advance-order-request, reject-order-request
        │       ├── projects/
        │       ├── subtasks/
        │       └── users/
        │
        ├── infrastructure/             # Concrete implementations
        │   ├── config.js               # USE_MOCK flag
        │   ├── http/
        │   │   └── client.js           # Axios + auth header
        │   └── mock/
        │       ├── store.js            # In-memory state + localStorage
        │       ├── seed/
        │       ├── repositories/       # mock-auth, mock-user, mock-project, mock-subtask, mock-demo, mock-order, mock-handover
        │       └── helpers/
        │
        ├── hooks/
        │   ├── useAuth.js
        │   ├── useProjects.js
        │   ├── useProjectsStore.jsx
        │   ├── useProjectModal.jsx
        │   ├── useTheme.js
        │   └── useCelebration.jsx
        │
        ├── data/                       # Static catalogs (order quantities, product info)
        │   ├── orderAdet.js
        │   ├── productCatalog.js
        │   └── productInfo.js
        │
        ├── lib/
        │   └── utils.js
        │
        ├── components/
        │   ├── AppShell.jsx            # Layout + role-based sidebar (navGroups) + notification bell
        │   ├── ProjectCard.jsx
        │   ├── StageBar.jsx
        │   ├── MonthTimeline.jsx
        │   ├── NewProjectDialog.jsx
        │   ├── DemoFormDialog.jsx
        │   ├── DemoSubmitDialog.jsx
        │   ├── OzalitFormDialog.jsx
        │   ├── ApprovalDialog.jsx
        │   ├── ConfirmDialog.jsx
        │   ├── TalepSignDialog.jsx
        │   ├── AssigneeAvatars.jsx
        │   ├── FilterChip.jsx
        │   ├── YearPlanSummary.jsx
        │   ├── NotificationSync.jsx
        │   ├── CelebrationOverlay.jsx
        │   └── ui/                     # shadcn/ui generated primitives
        │
        └── pages/
            ├── Login.jsx               # Email + password, quick-login demo users
            ├── AcceptInvite.jsx        # Set password from email link
            ├── Dashboard.jsx           # Monthly timeline + project cards
            ├── AllProjects.jsx         # /projects — full list
            ├── MyProjects.jsx          # /my-projects — designer only
            ├── ProjectDetail.jsx       # Subtasks, stage bar, history (also opens as modal sheet)
            ├── Kanban.jsx              # /kanban — board view
            ├── YearPlan.jsx            # /plan — yıllık plan
            ├── DemoRequests.jsx        # /demo — designer + team_leader
            ├── BaskiListesi.jsx        # /baski-listesi — print queue
            ├── UrunBilgileri.jsx       # /urun-bilgileri — product catalog (team_leader)
            ├── Approvals.jsx           # /approvals/{demo,ozalit,siparis}
            ├── SiparisListesi.jsx      # /siparis-talebi — satis: create + list orders
            ├── SiparisTalepleri.jsx    # /siparis-talepleri — team_leader
            ├── SiparisOnay.jsx         # /siparis-onay — designer
            ├── UretimeHazir.jsx        # /uretime-hazir — printer
            ├── TeslimTalepleri.jsx     # /teslim-talepleri — printer raises handover
            ├── TeslimOnaylari.jsx      # /teslim-onaylari — satis confirms
            ├── Documents.jsx           # /documents
            ├── Settings.jsx            # /settings
            └── Team.jsx                # /team — team_leader only
```

---
## 🗄️ Database Schema (planned)
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password      TEXT,                        -- null until invite accepted
  role          TEXT NOT NULL
    CHECK (role IN ('team_leader','designer','printer','satis')),
  is_active     BOOLEAN DEFAULT TRUE,
  invited_at    TIMESTAMPTZ,
  joined_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('TR','CIN')),
  stage         TEXT NOT NULL DEFAULT 'tasarim'
    CHECK (stage IN (
      'tasarim','demo_teslim','demo_onay',
      'ozalit_teslim','ozalit_onay',
      'cin_demo_teslim','cin_demo_onay',
      'uretime_hazir','uretimde','gumruk','satista'
    )),
  assigned_to   UUID REFERENCES users(id),
  created_by    UUID REFERENCES users(id),
  target_month  DATE,                        -- first day of target month
  demo_attempt  INTEGER DEFAULT 0,
  ozalit_attempt INTEGER DEFAULT 0,
  progress      INTEGER DEFAULT 0,           -- 0-100, auto-calculated
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE subtasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,              -- 'Kapak', 'Kutu', 'Ses' etc.
  is_done       BOOLEAN DEFAULT FALSE,
  pages_done    INTEGER,                     -- for 'Sayfa Sayısı'
  done_at       TIMESTAMPTZ
);
CREATE TABLE subtask_updates (              -- per-subtask timeline notes
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id    UUID REFERENCES subtasks(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  author_id     UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE demos (                        -- submitted demo forms
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  payload       JSONB NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE order_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','goruldu','tasarimci_onay','matbaa_onay','onaylandi','rejected')),
  requested_by  UUID REFERENCES users(id),
  payload       JSONB,                      -- adet, ürün bilgisi, etc.
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE handovers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed')),
  raised_by     UUID REFERENCES users(id),
  confirmed_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ
);
CREATE TABLE stage_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  action        TEXT NOT NULL              -- 'advance' | 'approve' | 'reject'
    CHECK (action IN ('advance','approve','reject')),
  reason        TEXT,                      -- required when action = 'reject'
  reject_target TEXT,                      -- 'matbaa' | 'designer' (ozalit rejection only)
  done_by       UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT UNIQUE NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);
-- Indexes
CREATE INDEX idx_projects_stage ON projects(stage);
CREATE INDEX idx_projects_assigned ON projects(assigned_to);
CREATE INDEX idx_projects_month ON projects(target_month);
CREATE INDEX idx_subtasks_project ON subtasks(project_id);
CREATE INDEX idx_history_project ON stage_history(project_id);
CREATE INDEX idx_orders_status ON order_requests(status);
CREATE INDEX idx_orders_project ON order_requests(project_id);
CREATE INDEX idx_handovers_status ON handovers(status);
```
---
## 🔌 API Endpoints
### Auth
```
GET    /api/auth/google               redirect to Google OAuth consent screen
GET    /api/auth/google/callback      OAuth callback → creates session in Redis → redirect
POST   /api/auth/logout               destroy session in Redis
GET    /api/auth/me                   → { user } from session
```
### Projects
```
GET    /api/projects                  → all projects (filter: type, stage, month, assigned_to)
GET    /api/projects/:id              → project + subtasks + stage history
POST   /api/projects                  { title, type, assigned_to, target_month, subtasks[] } [team_leader]
PATCH  /api/projects/:id              { title, assigned_to, target_month } [team_leader]
DELETE /api/projects/:id              [team_leader]
```
### Stage Transitions
```
POST   /api/projects/:id/advance      move to next stage [designer or team_leader]
POST   /api/projects/:id/approve      { stage } [printer for demo/ozalit, team_leader for cin]
POST   /api/projects/:id/reject       { stage, reason, reject_target? } [team_leader only]
                                       reject_target ∈ { 'matbaa' | 'designer' } for ozalit_onay
```
### Subtasks
```
PATCH  /api/subtasks/:id              { is_done, pages_done? } [designer]
POST   /api/subtasks/:id/updates      { note } — append a timeline update
PUT    /api/projects/:id/subtasks     replace subtask list [team_leader]
```
### Demos
```
GET    /api/demos                     → all submitted demo forms
POST   /api/demos                     { project_id, payload } [designer]
```
### Orders (Sipariş Talep workflow)
```
GET    /api/orders                    filter by status; per-role defaults applied
POST   /api/orders                    { project_id, payload } [satis] — project must be in 'satista'
PATCH  /api/orders/:id/advance        [role per ORDER_STEP_OWNER]
PATCH  /api/orders/:id/reject         { reason, reject_target } [team_leader]
```
### Handovers (Teslim)
```
GET    /api/handovers                 per-role list
POST   /api/handovers                 { project_id } [printer] — project must be in handover-eligible stage
PATCH  /api/handovers/:id/confirm     [satis] — moves project to 'satista'
```
### Users
```
GET    /api/users                     [team_leader]
POST   /api/users/invite              { name, email, role: 'designer'|'printer'|'satis' } → sends email [team_leader]
PATCH  /api/users/:id/deactivate      [team_leader]
PATCH  /api/users/:id/reactivate      [team_leader]
```
---
## 🖥️ UI Views by Role
| Role         | Default landing   | Pages / can do |
|--------------|-------------------|----------------|
| `team_leader`| Dashboard (`/`)   | Everything — Dashboard, All Projects, Kanban, Yıllık Plan, Demo Requests, Baskı Listesi, Onaylar (Demo/Ozalit), Sipariş Talepleri, Ekip, Ürün Bilgileri, Dökümanlar, Ayarlar |
| `designer`   | My Projects       | My Projects, All Projects (filtered to mine), Kanban, Demo Requests, Sipariş Onayları (orders at `goruldu`), Baskı Listesi, Dökümanlar, Ayarlar |
| `printer`    | Onaylar (Demo)    | Onaylar (Demo / Ozalit / Sipariş), Üretime Hazır, Teslim Talepleri, Kanban, Baskı Listesi, Dökümanlar, Ayarlar |
| `satis`      | Sipariş Talebi    | Sipariş Talebi (raise new orders for `satista` projects), Teslim Onayları (confirm Alındı → moves to `satista`), Tüm Ürünler (read-only catalog), Ayarlar |

Sidebar grouping is computed in `AppShell.navGroups()` and groups items into:
1. **Ana menü** — Dashboard, Projelerim / Tüm Projeler, İş Akışı, Baskı Listesi, Toplantılar (yakında), Satış-only: Sipariş Talebi, Tüm Ürünler
2. **Onaylar** (printer + team_leader; satis only sees Teslim Onayları)
3. **Yönetim / kaynaklar** — Ekip (team_leader only), Dökümanlar, Ürün Bilgileri (team_leader only)
4. **Acil İşler** (yakında) — pinned projects sorted by attempt counter

Each entry can be role-restricted via the `roles: [...]` field on the nav item and is hidden when the user role isn't in the allow-list.

### Notification bell
A persistent per-user log (capped at 50, stored in `localStorage` under `yz_notif_log_{userId}`) is built from live project + order state. Each role gets a tailored feed:
- `team_leader` — items needing approval, design 100% complete, attempt-counter alerts
- `printer` — incoming demo / ozalit teslim
- `designer` — new assignment, rejection ("Revizyon gerekiyor"), ozalit designer-approval
- `satis` — green "Talebiniz onaylandı — üretime alındı" when their own order reaches `onaylandi`
---
## 📐 Conventions
- Backend: Node.js + Fastify, ES modules, async/await, errors as `{ status, message }`
- Fastify schema validation on all route inputs (JSON Schema)
- Frontend: functional components + hooks only, shadcn/ui for all UI primitives
- All API calls through `client/src/api.js` (the composition-root facade) — no other layer imports infrastructure directly
- Auth: OAuth session cookie (httpOnly, sameSite=strict), session data in Redis
- Dates: stored UTC, displayed `tr-TR` locale
- Stage transitions: always go through `/advance`, `/approve`, `/reject` — never direct PATCH on stage
- Progress %: recalculated server-side on every subtask PATCH
- Rejection always requires `reason` field — backend enforces this
- Redis keys: `session:{id}` (TTL 7d), `cache:projects` (TTL 30s), `notify:{userId}` (pub-sub)
- Production gate: `assertCanEnterProduction(nextStage, progress)` throws 400 if a project tries to enter Ozalit+ with progress < 100%
- Order eligibility: `assertOrderable(project)` throws 400 if `project.stage ∉ { 'satista' }`
- Handover eligibility: `assertHandoverEligible(project)` throws 400 if the project is not at `uretimde` (TR) / `gumruk` (ÇİN)
- Mock/Infra seam: `infrastructure/config.js` exposes `USE_MOCK`; flipping it to `false` switches repositories from `mock/*` to `http/*` without changing the application or presentation layer.
---
## 🚀 Deploy (Dokploy + Nixpacks)

The app is a Vite SPA that lives in `client/`. Dokploy auto-detected the repo
but couldn't find a `start` script because the **root `package.json`** has no
scripts. We fix that with a `nixpacks.toml` + a tiny static server.

- **Build root:** repo root (`/`) — `nixpacks.toml` runs `npm ci` and `npm run build` inside `client/`
- **Output:** `client/dist/`
- **Start:** `node serve.cjs` (zero-dep Node http server with SPA fallback + cache headers)
- **Port:** `3000` (Dokploy sets `PORT`; we honour it)
- **Env vars:** see `.env.example` (commit-safe; real values go in Dokploy's env UI)

---

## 🚀 Production Checklist
- [ ] OAuth app registered in Google Cloud Console (client ID + secret in .env)
- [ ] Session cookie: httpOnly, sameSite=strict, secure=true in production
- [ ] Redis session TTL set to 7 days; auto-refresh on activity
- [ ] Role middleware on every protected Fastify route
- [ ] Fastify JSON schema validation on all POST/PATCH inputs
- [ ] Rate limiting via Redis on auth + sensitive routes
- [ ] Invitation flow: add email to allowlist in DB → user signs in via Google
- [ ] File uploads: type + size validated
- [ ] `.env` never committed
- [ ] CORS locked to production domain
- [ ] DB connection pool max 10
- [ ] Redis connection with retry + reconnect strategy
- [ ] HTTP-only repository implementations (currently mock) — see `client/ARCHITECTURE.md` → "Switching to the real backend"
- [ ] Backend (Fastify + PostgreSQL + Redis) — greenfield per `client/ARCHITECTURE.md` migration status

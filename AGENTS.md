# YZ Yayın Takip — Internal Publication Tracker
> Production-ready MVP for Yükselen Zeka's internal book publishing pipeline
---
## 🏢 What This Is
YZ Yayın Takip replaces analog/Excel workflows with a unified dashboard where the team leader (Ayşenur) can see every book project, who is working on what, and what stage it's in — in real time.
**Roles:**
- **Ayşenur (team_leader)** — the only user who creates projects, assigns designers, approves/rejects at every stage, manages team members
- **Designer (designer)** — works on assigned projects, checks off subtasks, marks completion
- **Oktay (printer)** — approves Demo and Özalit stages for TR projects only
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
    ✓ Oktay approves → Üretimde
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (attempt counter +1)
    ↓
Üretimde
    ↓
Satışta ✅
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
    ✓ Ayşenur approves → Üretimde
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (attempt counter +1)
    ↓
Üretimde
    ↓
Gümrük
    ↓
Satışta ✅
```
### Rejection Rule
- Every rejection requires a written reason
- The reason is stored and visible on the project history
- The demo attempt counter increments on each rejection (Demo 1, Demo 2, etc.)
- Only Ayşenur can reject at any stage
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
---
## 👥 User Management
- Only Ayşenur can add / deactivate team members
- When adding a user: name + email + role (designer or printer)
- System sends email invitation with a link to set password
- Deactivated users lose access immediately but their project history is preserved
- Roles: `team_leader` | `designer` | `printer`
---
## 📋 Project Subtasks
When creating a TR project, Ayşenur selects which subtasks apply:
- Kapak (cover)
- Kutu (box)
- Ses (sound)
- Video / Animasyon
- Yazılım (software)
- İçerik / Görsel (content / visuals)
- Sayfa Sayısı (page count — numeric field)
For ÇİN projects same subtasks apply. Each subtask can be checked off by the designer. Progress % = completed subtasks / total subtasks × 100.
---
## 🏗️ System Architecture
```
[React Frontend] ──▶ [Node/Fastify REST API] ──▶ [PostgreSQL]
                            │                          │
                    ┌───────┼────────┐            [Redis]
                [OAuth]  [Email]  [Notifications]  (sessions, cache, pub-sub)
```
**Tech Stack:**
| Layer        | Choice                  | Why                                          |
|--------------|-------------------------|----------------------------------------------|
| Frontend     | React + Vite            | Fast, component-based, easy to extend        |
| UI / Icons   | shadcn/ui + Tailwind    | Prebuilt accessible components, utility-first |
| Backend      | Node.js + Fastify       | Faster than Express, built-in schema validation |
| Database     | PostgreSQL              | Relational, ACID, great for pipelines        |
| Cache / RT   | Redis                   | Session store, notification pub-sub, caching |
| Auth         | OAuth (Google)          | No passwords to manage, team uses Google     |
| Email        | Nodemailer              | Invitations + stage notifications            |
| Hosting      | Railway / Render        | One-click deploys, free tier                 |

**Redis usage in this app:**
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
├── server/
│   ├── index.js
│   ├── db.js                    # PostgreSQL connection pool
│   ├── redis.js                 # Redis client + helpers
│   ├── middleware/
│   │   ├── auth.js              # OAuth session verify + role attach
│   │   └── requireRole.js       # role-based guard
│   ├── routes/
│   │   ├── auth.js              # OAuth callback, session, logout, /me
│   │   ├── projects.js          # CRUD + stage transitions
│   │   ├── subtasks.js          # check/uncheck subtasks
│   │   ├── approvals.js         # approve / reject with reason
│   │   └── users.js             # invite, deactivate, list
│   ├── services/
│   │   ├── email.js             # nodemailer wrapper
│   │   ├── notifications.js     # stage change notifications (Redis pub-sub)
│   │   └── session.js           # Redis session store helpers
│   └── db/
│       ├── schema.sql
│       └── seed.sql
│
└── client/
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js
        ├── hooks/
        │   ├── useAuth.js
        │   └── useProjects.js
        ├── pages/
        │   ├── Login.jsx
        │   ├── AcceptInvite.jsx  # set password from email link
        │   ├── Dashboard.jsx     # monthly timeline + project cards
        │   ├── ProjectDetail.jsx # subtasks, stage bar, history
        │   └── Team.jsx          # user management (Ayşenur only)
        └── components/
            ├── ui/               # shadcn/ui generated components
            ├── ProjectCard.jsx
            ├── StageBar.jsx
            ├── SubtaskList.jsx
            ├── ApprovalModal.jsx # approve / reject + reason input
            └── MonthTimeline.jsx
```
---
## 🗄️ Database Schema
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password      TEXT,                        -- null until invite accepted
  role          TEXT NOT NULL
    CHECK (role IN ('team_leader','designer','printer')),
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
      'uretimde','gumruk','satista'
    )),
  assigned_to   UUID REFERENCES users(id),
  created_by    UUID REFERENCES users(id),
  target_month  DATE,                        -- first day of target month
  demo_attempt  INTEGER DEFAULT 0,
  progress      INTEGER DEFAULT 0,           -- 0-100, auto-calculated
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE subtasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,              -- 'Kapak', 'Kutu', 'Ses' etc.
  is_done       BOOLEAN DEFAULT FALSE,
  done_at       TIMESTAMPTZ
);
CREATE TABLE stage_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  from_stage    TEXT,
  to_stage      TEXT NOT NULL,
  action        TEXT NOT NULL              -- 'advance' | 'approve' | 'reject'
    CHECK (action IN ('advance','approve','reject')),
  reason        TEXT,                      -- required when action = 'reject'
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
POST   /api/projects/:id/reject       { stage, reason } [team_leader only]
```
### Subtasks
```
PATCH  /api/subtasks/:id              { is_done: true/false } [designer]
```
### Users
```
GET    /api/users                     [team_leader]
POST   /api/users/invite              { name, email, role } → sends email [team_leader]
PATCH  /api/users/:id/deactivate      [team_leader]
PATCH  /api/users/:id/reactivate      [team_leader]
```
---
## 🖥️ UI Views by Role
| Role         | Default landing  | Can do                                              |
|--------------|------------------|-----------------------------------------------------|
| team_leader  | Dashboard        | Everything — create, assign, approve, reject, manage team |
| designer     | My Projects      | See assigned projects, check subtasks, submit demo  |
| printer      | Approval queue   | See projects awaiting Demo/Özalit approval, approve |
---
## 📐 Conventions
- Backend: Node.js + Fastify, ES modules, async/await, errors as `{ status, message }`
- Fastify schema validation on all route inputs (JSON Schema)
- Frontend: functional components + hooks only, shadcn/ui for all UI primitives
- All API calls through `client/src/api.js` (Axios + session cookie)
- Auth: OAuth session cookie (httpOnly, sameSite=strict), session data in Redis
- Dates: stored UTC, displayed `tr-TR` locale
- Stage transitions: always go through `/advance`, `/approve`, `/reject` — never direct PATCH on stage
- Progress %: recalculated server-side on every subtask PATCH
- Rejection always requires `reason` field — backend enforces this
- Redis keys: `session:{id}` (TTL 7d), `cache:projects` (TTL 30s), `notify:{userId}` (pub-sub)
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

## Imported Claude Cowork project instructions

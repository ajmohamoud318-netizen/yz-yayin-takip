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
| `printer` | Matbaa | Oktay Şahin, Atilla Kılıçkan | Onaylar (`/approvals/demo`) |
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
    ✓ Ayşenur OR Oktay approves → Özalit
    ✗ Ayşenur rejects (reason REQUIRED) → back to Tasarım (demo_attempt +1)
    ↓
Özalit Teslim
    ↓
Özalit Onay — single-step
    ✓ Ayşenur approves → Üretime Hazır
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
    ✓ Ayşenur OR Oktay approves → Üretime Hazır
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

### Demo Rule (demos are exempt from the 100% gate)
Demos are a **review checkpoint**, not a production step. The 100% gate kicks in at ozalit — a half-finished design must not reach the print proof or the press.

- **Designer or team leader can request a demo at any progress.** The team leader's request is `tasarim → demo_teslim`; the designer's is the same path (assigned designers are listed in `availableActions` at `tasarim`). No second demo request is allowed while one is in flight (`stage ∈ {demo_teslim, demo_onay, cin_demo_teslim, cin_demo_onay}`).
- **Matbaa delivers the demo** (`demo_teslim → demo_onay`); a printer-only `advance`.
- **Team leader approves or rejects.** On rejection, they pick the responsible party (`designer` | `matbaa`) and a reason.
- **Approved demo at <100% is a "hold"**: the leader's approve is recorded, the project stays at `demo_onay`, `demo_held = true`. The designer keeps working on the held project — the UI shows a yellow "Tasarım tamamlanmadı — onay sonraki aşamaya geçirmez" hint next to the approve button.
- **The designer (or leader) sends a second demo** via "Demo İste" at any demo stage (allowed at any progress and any held-state — the team may iterate again once a demo has been reviewed). The server's `computeAdvance` re-send branch moves the project straight to the pipeline's teslim stage (`demo_onay → demo_teslim` for TR, `cin_demo_onay → cin_demo_teslim` for ÇİN) and bumps `demo_attempt`, so the matbaa immediately receives the new demo. The full demo loop re-runs (`demo_teslim → demo_onay`); leader approves again to advance to `ozalit_teslim`.
- **"Teslim Alınamadı" (not received)**: the counterpart to "Teslim Alındı" — if the delivered demo never actually reached the leader/designer, either can report it instead of leaving the project stuck at `demo_onay`/`cin_demo_onay` with no way forward (Onayla/Reddet stay blocked until received; see the Demo Rule above). `computeDemoNotReceived` sends it back to the matbaa's teslim stage and bumps `demo_attempt`, same as any other back-to-teslim transition. Route: `POST /api/projects/:id/demo-not-received`.

Enforced by:
- `client/src/domain/services/pipeline.js#assertCanEnterProduction` (gate at ozalit onward, not at demo)
- `client/src/domain/services/pipeline.js#assertDemoCanAdvance` (the `<100%` hold explanation)
- `server/src/domain/transitions.js#computeAdvance` (the "tekrar demo" branch)
- `server/src/domain/transitions.js#computeApproval` (the demo_onay `<100%` hold branch)

### Rejection Rule (main pipeline)
- Every rejection requires a written `reason` (backend-enforced)
- The reason is stored in `stage_history` and visible on the project history
- The `demo_attempt` / `ozalit_attempt` counter increments on each rejection (Demo 1, Demo 2, …)
- `team_leader` can reject at any stage
- At Özalit rejection, the leader picks the loop target: `matbaa` (Matbaa re-delivers ozalit) or `designer` (Tasarımcı reworks first)
- **"Teslim Alınamadı" (not received)**: ozalit approval has no receipt gate (unlike demo — this is intentional, see migration `021__demo_received.sql`), but the leader or an assigned designer can still report that a delivered ozalit never reached them. `computeOzalitNotReceived` sends the project back to `ozalit_teslim` with the matbaa re-delivery lock (`reject_target: 'matbaa'`, same mechanism as reject-to-matbaa), wipes the partial multi-party approval ledger, and bumps `ozalit_attempt`. Route: `POST /api/projects/:id/ozalit-not-received`.

---
## 🛒 Sipariş (Order) Mini-Workflow — sales re-prints
Separate from the main pipeline. Satış Ekibi raises an order for a project that has reached `uretime_hazir` or any later stage (`uretimde`, `gumruk`, `satista`) — production doesn't need to be fully sold through, just finished; the project cycles through the team, designer, and matbaa again. Defined in `client/src/domain/constants/orders.js`.

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
- `canRequestOrder` (and the throwing `assertOrderable`) gate the create-order use case to projects whose `stage ∈ ORDERABLE_STAGES = { 'uretime_hazir', 'uretimde', 'gumruk', 'satista' }`, that have a non-empty `has_product_info` entry, and that the team leader hasn't delisted (`catalog_hidden` — see "Kaldırma")
- The Ürünler catalog page (`pages/Urunler.jsx`) splits this pool into two groups for Sales: "Sipariş İçin Hazır" (production finished, not yet fully sold — `uretime_hazir`/`uretimde`/`gumruk`) and "Halihazırda Satışta" (`satista`)
- `components/OrderRequestDialog.jsx` has three entry paths, all ending in the same `POST /api/orders` calls:
  - **row click** — the per-product "Sipariş" button passes `initialProductId` and jumps straight to the quantity form
  - **Ürün seç** — the "Sipariş Oluştur" button opens a searchable, multi-select catalog picker (default mode)
  - **Excel yükle** — the same button's other mode; a dropped `.xlsx/.xls/.csv` is fuzzy-matched (`matchScore`, TR-normalized) against product titles and component names

  One product — picked or matched — lands on the itemized "Kalem adetleri" form (a quantity per component); two or more land on the batch screen (one quantity per product, applied to all of its components), which submits an order per row.

### Kayıtlı ürünler (legacy) — backlist titles

Books published before this system existed used to be unable to reach Ürünler:
`insertProject` hardcoded `stage = 'tasarim'`, so a backlist title would have had
to be walked through fake demos and a full multi-party ozalit approval to become
orderable.

The source data already existed. `client/src/data/productInfo.js` is generated
from **REÇETE.xlsx** and holds ~93 product specs keyed by seed id (`p-x1`…).
`pages/UrunBilgileri.jsx` renders them as synthetic orphan rows (`__seed: true`)
when no matching project exists. Un-promoted, they are **browser-local only** —
saving one calls `PUT /api/product-info/p-x1`, which 404s (`Proje bulunamadı`)
into a swallowed catch, and `hydrateProductInfo` drops orphan overrides on next
boot. Promoting a row is what makes its spec real.

**Promote from Ürün Bilgileri; there is no file import.** The team leader ticks
orphan rows (checkbox per row, plus "Tüm kayıtları seç") and confirms `type` +
`stage` in the `PromoteDialog` — REÇETE.xlsx carries specs only, no TR/ÇİN and no
stage, so both are asked once and applied to the whole selection.
`POST /api/projects/import` then creates each project and its `product_info` row
in one transaction, and the orphan row converts in place.

Rules that are not obvious and must not be re-litigated:

- **`origin = 'legacy'`** on the created project (see schema below). Without it
  backlist titles inflate `AppShell`'s `active`/`total`/`satista` counts and
  `PeriodWidget` renders a meaningless "180/200 satışta".
- **Filter in one place**: `useProjectsStore` exposes `projects` (pipeline only)
  and `allProjects`. Every page inherits the filter. Ürünler needs no change —
  it calls `api.listProjects()` directly and keeps seeing everything. Ürün
  Bilgileri deliberately opts into `allProjects`: on the filtered list a promoted
  product would fall out of the "real project" branch and the orphan branch would
  re-add it as an un-promoted seed, offering "Ürünlere Ekle" for a product that
  already exists.
- **Reuse the seed id** (`p-x1`, not a fresh `p-<nanoid>`). `insertProject`
  already honours `fields.id`, and reusing it makes `realKeys.has(pid)` true so
  the orphan row converts in place instead of duplicating. Restrict the route to
  `/^p-x\d+$/` and 409 on collision.
- **`progress: 100`** — every orderable stage is in `STAGES_REQUIRING_FULL_PROGRESS`,
  and `statusKeyForProject` colours off progress. A finished book at `satista`
  with `progress: 0` renders as a red overdue card.
- **`pass_kind: 'first_edition'`, not `'reprint'`** — `pass_kind` describes the
  pass the project is currently in, and the legacy book's untracked pass *was*
  its first edition. It flips to `reprint` when Sales orders it.
- **Guard the pipeline routes.** `assertNotLegacy` (`domain/pipeline.js`, mirrored
  client-side in `domain/services/pipeline.js`) 400s `/advance`, `/approve`,
  `/reject`, `/receive`, `/demo-not-received`, `/ozalit-not-received` and
  `POST /demos` — these projects have no subtasks, designer or history. Without
  the guard one click on Advance walks a 2019 title into `demo_teslim`, it
  vanishes from Ürünler, and Sales silently loses the ability to order it.
  `availableActions` in `ProjectDetail.jsx` returns `[]` for legacy so the SPA
  never offers a button the API rejects. Sipariş and teslim stay open — putting
  backlist books into those flows is the reason for importing them.
- History is logged with `event: 'legacy_import'` (free-form column, migration
  014) and rendered as "Kayıttan Ürün Olarak Eklendi" in the project timeline.
- Titles **not** among the 93 seeds use the existing "Yeni Ürün" flow. A CSV
  importer is a later phase if the backlist grows beyond REÇETE.xlsx; the
  endpoint is already generic enough to serve one.

### Kaldırma — taking a product out of the catalog

The inverse of promoting. A book goes out of print, a title shouldn't be
reordered this period — Sales must stop seeing it, but the project itself is
still real work with real history. `catalog_hidden` (migration 033) is that
middle ground, driven by the "Kaldır" button on each Ürünler row
(`POST /api/projects/:id/catalog`, team_leader only).

- **Not a soft delete.** `DELETE /api/projects/:id` (029) removes the project
  from every pipeline view, the timeline and the dashboards. Delisting touches
  nothing but catalog membership: same stage, same history, same assignees.
- **Enforced server-side, not just hidden.** `assertOrderable` throws its own
  message ("Bu ürün katalogdan kaldırıldı") so a stale Sales tab can't post an
  order for a delisted product — and so the copy doesn't tell Sales to wait for
  production that already finished. `isCatalogListed` is the shared predicate
  (`domain/pipeline.js`, mirrored client-side).
- **Reversible, and visibly so.** Delisted rows stay on the Ürünler page for the
  leader in a "Katalogdan Kaldırıldı" section with a "Geri Al" button; every
  other role, Sales included, sees a catalog that simply lacks them. That's why
  there's no confirm dialog — undo is one click away in the section below.
- **Hiding is restricted to catalog stages.** The route 400s when `hidden` is
  requested for a project outside `ORDERABLE_STAGES`: such a flag would be
  invisible and un-undoable from the only page that can clear it. Re-listing is
  always allowed.
- **Idempotent.** Re-sending the state a product is already in is a no-op, so a
  retry can't produce a second history row or a second notification. `hidden` is
  explicit in the body rather than a server-side toggle for the same reason.
- History: `event: 'catalog_delist'` / `'catalog_relist'`, rendered as
  "Katalogdan Kaldırıldı" / "Katalogda Tekrar Yayında" and grouped under
  **Sipariş** in the timeline filter — the stage never moved; what changed is
  whether Sales can order.
- Notifies `satis` + the other team leaders (`product_delisted` /
  `product_relisted`). Designers and printers are not told: delisting changes
  nothing about the production work they own.

> **"Ürünü Sil" in Ürün Bilgileri is a different thing** and does not delist.
> There is no `DELETE /api/product-info/:projectId`; that button saves an empty
> `components` array, which clears the spec sheet only. It does now make the
> product unorderable — `has_product_info` tests `components <> '[]'` rather
> than the row's mere existence — but the product stays in Ürünler, flagged
> "Ürün bilgisi eksik". Use Kaldır to remove it from the catalog.

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
- 🟣 Purple — Devam Eden / in progress (includes the first demo cycle — `demo_teslim` + `demo_onay` before the leader has approved once)
- 🟢 Green — Second demo cycle in flight (leader already approved once, designer reached 100%, demo re-sent) — ready for the leader to send to Özalit
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
```

**Tech Stack:**
| Layer        | Choice                  | Why                                          |
|--------------|-------------------------|----------------------------------------------|
| Frontend     | React + Vite            | Fast, component-based, easy to extend        |
| UI / Icons   | shadcn/ui + Tailwind    | Prebuilt accessible components, utility-first |
| State hooks  | Context + custom hooks  | `useProjectsStore`, `useProjectModal`, etc.  |
| Architecture | Clean Architecture      | Domain ← Application → Presentation; HTTP repos behind ports |
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
  origin        TEXT NOT NULL DEFAULT 'pipeline'  -- migration 031
    CHECK (origin IN ('pipeline','legacy')), -- 'legacy' = backlist import, see Kayıtlı ürünler
  catalog_hidden    BOOLEAN NOT NULL DEFAULT FALSE, -- migration 033, "kaldırıldı"
  catalog_hidden_at TIMESTAMPTZ,                    -- cleared on re-listing
  catalog_hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE subtasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,              -- 'Kapak', 'Kutu', 'Ses' etc.
  is_done       BOOLEAN DEFAULT FALSE,
  pages_done    INTEGER,                     -- for 'Sayfa Sayısı'
  needs_revize  BOOLEAN NOT NULL DEFAULT FALSE,  -- migration 017
  position      INTEGER NOT NULL DEFAULT 0,      -- leader's explicit order, migration 027
  done_at       TIMESTAMPTZ
);
CREATE TABLE subtask_updates (              -- per-subtask timeline notes
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subtask_id    UUID REFERENCES subtasks(id) ON DELETE CASCADE,
  note          TEXT NOT NULL,
  author_id     UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
-- NOTE: that CASCADE is why `PUT /projects/:id/subtasks` must never
-- delete-and-recreate the list. It reconciles in place (UPDATE survivors
-- matched by title, INSERT new, DELETE only removed) so kept subtasks keep
-- their id — and therefore their notes, pages_done/stickers_done and
-- needs_revize. Ordering rides on `position`, not row creation time.
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
CREATE TABLE notifications (             -- durable per-recipient feed (migration 022)
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- recipient
  type          TEXT NOT NULL,           -- event key (assignment, demo_approval_pending, order_step, …)
  title         TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  tone          TEXT NOT NULL DEFAULT 'blue'
    CHECK (tone IN ('amber','green','rose','blue','pink')),
  project_id    TEXT REFERENCES projects(id) ON DELETE CASCADE,
  order_id      TEXT,
  link          TEXT,                    -- SPA route to open on click
  actor_id      TEXT REFERENCES users(id) ON DELETE SET NULL,  -- suppresses self-notify
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,  -- per-item bold (cleared on click)
  read_at       TIMESTAMPTZ,
  seen          BOOLEAN NOT NULL DEFAULT FALSE,  -- bell badge (cleared on open) — migration 024
  seen_at       TIMESTAMPTZ,
  pushed_at     TIMESTAMPTZ,             -- push outbox: NULL = still owed — migration 034
  push_attempts SMALLINT NOT NULL DEFAULT 0,     -- transient-failure counter; cap PUSH_MAX_ATTEMPTS
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE work_log_entries (          -- "Çalışma Defteri" (migration 026)
  id            TEXT PRIMARY KEY,        -- wl-<nanoid>
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date    DATE NOT NULL DEFAULT CURRENT_DATE,  -- a DATE, not derived from created_at
  kind          TEXT NOT NULL DEFAULT 'diger'
    CHECK (kind IN ('baska_proje','toplanti','idari','egitim','diger')),
  body          TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 280),
  minutes       INTEGER,                 -- optional rough duration, NULL = unsaid
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes
CREATE INDEX idx_projects_stage ON projects(stage);
CREATE INDEX idx_projects_assigned ON projects(assigned_to);
CREATE INDEX idx_projects_month ON projects(target_month);
CREATE INDEX idx_subtasks_project ON subtasks(project_id);
CREATE INDEX idx_history_project ON stage_history(project_id);
CREATE INDEX idx_orders_status ON order_requests(status);
CREATE INDEX idx_orders_project ON order_requests(project_id);
CREATE TABLE push_subscriptions (         -- web push devices (migration 032)
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,     -- push service URL; UNIQUE so re-subscribe upserts
  p256dh        TEXT NOT NULL,            -- payload encryption key (from PushSubscription.getKey)
  auth          TEXT NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '', -- diagnostics only ("Oktay's iPhone" vs laptop)
  last_used_at  TIMESTAMPTZ,
  failed_at     TIMESTAMPTZ,              -- set on 404/410; excluded from fan-out, deleted after 72h
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_handovers_status ON handovers(status);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_unseen ON notifications(user_id) WHERE seen = FALSE;
CREATE INDEX idx_notifications_push_pending ON notifications(created_at) WHERE pushed_at IS NULL;  -- outbox tail
CREATE INDEX idx_notifications_created ON notifications(created_at);  -- retention pruner
CREATE INDEX idx_work_log_user_date ON work_log_entries(user_id, entry_date DESC, created_at DESC);
CREATE INDEX idx_work_log_date ON work_log_entries(entry_date DESC, created_at DESC);
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
POST   /api/projects/:id/catalog      { hidden, note? } [team_leader]
                                       "kaldır"/"geri al" — delist a product from Ürünler
                                       without touching the project. See "Kaldırma".
POST   /api/projects/import           { dryRun?, items[] } [team_leader]
                                       item: { id?, title, type, stage?, pass_kind?, components? }
                                       stage ∈ ORDERABLE_STAGES (default 'satista'); creates
                                       origin='legacy', progress=100 projects + product_info in
                                       one tx. See "Kayıtlı ürünler (legacy)".
```
### Stage Transitions
> Every route in this block 400s on `origin = 'legacy'` via `assertNotLegacy` — see "Kayıtlı ürünler (legacy)".
```
POST   /api/projects/:id/advance      move to next stage [designer or team_leader]
POST   /api/projects/:id/approve      { stage } [printer for demo/ozalit, team_leader for cin]
POST   /api/projects/:id/reject       { stage, reason, reject_target? } [team_leader only]
                                       reject_target ∈ { 'matbaa' | 'designer' } for ozalit_onay
POST   /api/projects/:id/receive               mark delivered demo "Teslim Alındı" [team_leader or assigned designer]
POST   /api/projects/:id/demo-not-received     report a delivered demo never arrived → back to matbaa [team_leader or assigned designer]
POST   /api/projects/:id/ozalit-not-received   report a delivered ozalit never arrived → back to matbaa [team_leader or assigned designer]
```
### Subtasks
```
PATCH  /api/subtasks/:id              { is_done, pages_done?, stickers_done?, needs_revize? } [designer]
POST   /api/subtasks/:id/revize       clear needs_revize — "revize edildi" [assigned designer]
POST   /api/subtasks/:id/updates      { note } — append a timeline update
PUT    /api/projects/:id/subtasks     replace subtask list [team_leader] — rows carry `id`
```
Who owns what on a subtask: the **team leader** owns the list's SHAPE (which
subtasks exist, their titles/kinds/totals/assignment) via the PUT; the
**designer** owns per-row STATE (done, counters, `needs_revize`) via the PATCH.
`needs_revize` is settable only by the subtask's assigned designer — it is how
the sipariş (reprint) check records which parts had to be redone for that run.
The team leader flags rework a different way, by rejecting a stage, which goes
through `computeRejection` rather than this endpoint.

The leader edits the list from **Ürün Bilgileri** (each product card carries an
Alt Görevler section) and from **Ürünler** (each catalog row expands into the
same editor) — one shared `components/ProductSubtaskEditor.jsx`, leader-gated by
`canEditProductInfo` and mounted only once its card/row is open, so a catalog of
90 products doesn't fire 90 `getProject` calls on load. The catalog placement is
there because a sipariş hands the designer whatever alt görevler the product
already has, and an imported backlist product (`origin='legacy'`) arrives with
none. Adding rows to a product at an orderable stage does NOT drop its progress
bar: `progressFor` pins every stage in `STAGES_REQUIRING_FULL_PROGRESS` at 100.

A **Kayıt** row on Ürün Bilgileri (`__seed`: a REÇETE.xlsx spec with no project
behind it) has no project row to hang subtasks on, so it gets an explanatory
placeholder plus a per-row **Ürünlere Ekle** button instead of the editor.
Rendering nothing there was a usability bug, not a safe default — most of the
page is kayıt rows, so the leader expanded card after card and concluded alt
görev ekleme didn't exist. Promotion reuses the seed id as the project id, so
the row converts in place and the real editor appears without collapsing it.

Send each row's `id` — the PUT reconciles on id and falls
back to title, so a RENAME keeps the original row. That matters because
`subtask_updates` FKs `ON DELETE CASCADE`: a title-only match turned every
rename into delete + insert and took the designer's notes with it. Echo each
row's current `is_done` back too, since the endpoint writes that column and
omitting it would reset designer progress. Valid `kind` values are
`check` / `pages` / `sticker-count` — matching migration 003's CHECK constraint.
### Demos
```
GET    /api/demos                     → all submitted demo forms
POST   /api/demos                     { project_id, payload } [designer]
```
### Orders (Sipariş Talep workflow)
```
GET    /api/order-requests            all orders, each with its order_history
POST   /api/order-requests            { projectId, quantity?, notes?, items?, payload? } [satis] — project must be in an ORDERABLE_STAGES stage (uretime_hazir/uretimde/gumruk/satista)
PATCH  /api/order-requests/:id/advance  { notes?, assignees?, expectedVersion? } [role per ORDER_STEP_OWNER]
PATCH  /api/order-requests/:id/reject   { reason, rejectTarget?, revizeIds? } [team_leader]
```
The route is `/api/order-requests`, not `/api/orders` — the client's use cases
and every repository call use the former.

`assignees` is REQUIRED on the `pending → goruldu` advance ("Tasarımcıya Aktar")
and is the authoritative record of who the order went to: it is stored on
`order_requests.assignee_ids`, while the project only ever receives
`assignees[0]` as its primary. Designer-facing views must filter orders on
`assignee_ids` (see `isOrderAssignedToDesigner`), never on project assignment.

`revizeIds` names the alt görevler that have to be redone, mirroring the main
pipeline's demo/ozalit rejection. It applies only when `rejectTarget` is
`'designer'` (a 'matbaa' reject re-delivers the same design; 'reassign' hands
the work to a new team), and sets `needs_revize` while leaving `is_done` and
progress untouched — the work was done, it just needs a touch-up. The designer
clears each flag via `POST /api/subtasks/:id/revize`.
### Handovers (Teslim)
```
GET    /api/handovers                 per-role list
POST   /api/handovers                 { project_id } [printer] — project must be in handover-eligible stage
PATCH  /api/handovers/:id/confirm     [satis] — moves project to 'satista'
```
### Web Push (device registration)
```
GET    /api/push/public-key           → { enabled, key } — VAPID key for PushManager.subscribe
POST   /api/push/subscribe            store this device (upsert on endpoint) → { ok, id }
DELETE /api/push/subscribe            forget this device (owner-scoped)      → { ok }
POST   /api/push/test                 push yourself one                      → { sent, pruned }
```

### Notifications
```
GET    /api/notifications             → { items, unread, unseen, nextCursor } for the current user
       ?limit=50 (max 100) &cursor=<opaque "<iso>|<id>" from the previous page's nextCursor>
       `unread`/`unseen` are whole-feed COUNTs, NOT counts of `items` — they used to be derived
       from the page, which capped the badge at the page size and hid every row past it.
       `nextCursor` is null on the last page. Keyset (not OFFSET) because the feed appends at
       the top; a malformed/stale cursor degrades to page 1 rather than 400ing.
PATCH  /api/notifications/:id/read     mark one read (also seen; owner-scoped)
POST   /api/notifications/read-all     mark all read (also seen) → { count }
POST   /api/notifications/seen         mark all seen (bell open; badge clear) → { count }
```
### Users
```
GET    /api/users                     any authenticated user → { id, name, role, is_active } minimal roster
                                       (assignee-name lookups); team_leader gets the full roster
                                       (email, invited/joined, daily_status, work_log_today)
POST   /api/users/invite              { name, email, role: 'designer'|'printer'|'satis' } → sends email [team_leader]
PATCH  /api/users/:id/deactivate      [team_leader]
PATCH  /api/users/:id/reactivate      [team_leader]
```
`GET /api/users` also returns, per row, `work_log_today` (today's Çalışma
Defteri entries as a JSON array) and `daily_status` (the newest of them) —
both derived in SQL, so /team renders everyone's day with no extra request.

### Work Log (Çalışma Defteri)
> **Disabled in the UI.** `WORK_LOG_ENABLED` in `client/src/lib/work-log.js`
> is `false`: no sidebar entry, no notes/dot on the /team cards, and nothing
> calls these routes. The endpoints, the `work_log_entries` table and the
> derived `work_log_today` / `daily_status` columns are all untouched — flip
> the flag to `true` to bring the feature back with its history intact.
```
GET    /api/work-log              ?days=14 → { entries, days } — the caller's own, newest first
POST   /api/work-log              { kind, body, minutes? } → 201 entry (dated today)
PATCH  /api/work-log/:id          { kind?, body?, minutes? } — owner-scoped
DELETE /api/work-log/:id          → 204 — owner-scoped
```
---
## 🖥️ UI Views by Role
| Role         | Default landing   | Pages / can do |
|--------------|-------------------|----------------|
| `team_leader`| Dashboard (`/`)   | Everything — Dashboard, All Projects, Kanban, Yıllık Plan, Demo Requests, Baskı Listesi, Onaylar (Demo/Ozalit), Sipariş Talepleri, Ekip, Ürün Bilgileri, Dökümanlar, Ayarlar |
| `designer`   | My Projects       | My Projects, All Projects (filtered to mine), Kanban, Demo Requests, Sipariş Onayları (orders at `goruldu`), Baskı Listesi, Dökümanlar, Ayarlar |
| `printer`    | Onaylar (Demo)    | Onaylar (Demo / Ozalit / Sipariş), Üretime Hazır, Teslim Talepleri, Kanban, Baskı Listesi, Dökümanlar, Ayarlar |
| `satis`      | Sipariş Talebi    | Sipariş Talebi (raise new orders for projects at `uretime_hazir`/`uretimde`/`gumruk`/`satista`), Teslim Onayları (confirm Alındı → moves to `satista`), Tüm Ürünler (catalog, order entry point), Ayarlar |

Sidebar grouping is computed in `AppShell.navGroups()` and groups items into:
1. **Ana menü** — Dashboard, Projelerim / Tüm Projeler, İş Akışı, Baskı Listesi, Toplantılar (yakında), Satış-only: Sipariş Talebi, Tüm Ürünler
2. **Onaylar** (printer + team_leader; satis only sees Teslim Onayları)
3. **Yönetim / kaynaklar** — Ekip (team_leader only), Dökümanlar, Ürün Bilgileri (team_leader only). Çalışma Defteri used to sit here; it is off behind `WORK_LOG_ENABLED`
4. **Acil İşler** (yakında) — pinned projects sorted by attempt counter. Shown to `team_leader` + `designer` only; `printer` and `satis` don't get this group, the pinned list, or the "Bu Dönem" period widget below it (re-send pressure and the satışa-çıkar goal aren't their workload)

Each entry can be role-restricted via the `roles: [...]` field on the nav item and is hidden when the user role isn't in the allow-list.

### Notifications (server-backed feed)
Notifications are **durable rows in the `notifications` table**, written server-side in the same transaction as the `stage_history` row that caused them (see `server/src/services/notifications.js#emit`, called from the transition routes). This replaced the old client-derived model (localStorage `yz_notif_log_{userId}` log + project-diffing toasts), which was best-effort, per-browser, and lost on refresh. Read-state, ordering and the unread count now live on the server, so the feed is consistent across devices.

Delivery is **polling** (the SPA authenticates with a trusted `X-User-Id` header, which EventSource/WebSocket can't attach cleanly): `useNotifications` (`client/src/hooks/useNotifications.jsx`) polls `GET /api/notifications` every 15s and is the single source for both the bell (`NotificationBell` in `AppShell.jsx`) and the arrival toasts (`NotificationSync.jsx`).

**Seen vs read (migration 024).** Two independent states, so the badge behaves like a real app without losing the to-do signal: `seen` drives the red **badge** and is cleared the moment the bell dropdown opens (a glance counts); `is_read` drives the per-item **bold** styling and is only cleared when the item is clicked (or "Tümünü okundu say"). Invariant: reading implies seeing (the service sets `seen` wherever it sets `is_read`). The bell shows a per-`type` icon in a tone-tinted circle (`TYPE_ICON` / `NotifIcon` in `AppShell.jsx`).

Recipient rules live once, in the service (`notifyProjectTransition`, `notifyProjectCreated`, `notifyOrderTransition`, `notifyOrderRejected`, `notifyHandoverRequested`, `notifyHandoverConfirmed`). The actor is never notified of their own action; recipients are resolved against the **active** user set. Per role the feed surfaces:
- `team_leader` — demo/ozalit approvals pending, production-ready, new sipariş talep steps
- `printer` — demo/ozalit delivery pending, production-ready, sipariş ozalit steps
- `designer` — new assignment, rejection ("Revizyon gerekiyor"), ozalit-requestable, assigned-order steps
- `satis` — handover confirmation pending, "Talebiniz onaylandı — üretime alındı", on-sale

Endpoints: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all` (all owner-scoped).

### Web push (migration 032)
Polling only works while a tab is open — useless for the matbaa team, who are on the print floor rather than at a desk. **Web push** adds a second delivery channel for the same feed: free, no third party, works on Android and on iOS 16.4+ once installed to the Home Screen.

WhatsApp was the original ask and was rejected on cost: Meta's Cloud API bills per business-initiated message, and its exemption for in-window utility messages ends **2026-10-01**. Unofficial WhatsApp libraries (Baileys, whatsapp-web.js) were rejected on risk — they violate Meta's ToS and get numbers banned without warning.

- **Storage**: `push_subscriptions`, one row per browser-on-device, `UNIQUE(endpoint)` so re-subscribing upserts instead of duplicating (duplicates = double notifications).
- **Fan-out**: `services/push.js#sendToRecipients`, invoked from `services/notifications.js#dispatchPush` at the end of `emit()` — so **every existing `notify*` helper gained push with zero call-site changes**.
- **Transaction discipline**: `dispatchPush` registers the send through **`client.afterCommit(...)`** (see `db/pool.js#withTx`), so it runs only once `COMMIT` succeeds and outside the transaction. Both properties matter: awaiting an HTTPS round-trip inside `withTx` would pin a pool connection per request, and pushing for a rolled-back approval is worse than missing one.
  - ⚠️ **Do not replace this with `setImmediate` + a "are the rows visible yet?" probe.** That was the original implementation and it was silently broken: `setImmediate` fires on the next event-loop check phase, which arrives long before the `withTx` callback resolves and `COMMIT` is issued, so the probe always found nothing and **every push for a real pipeline event was dropped**. Only `POST /api/push/test` worked, because it calls `sendToUsers` directly — which is exactly what made it look like "push works, but notifications don't arrive". Regression tests live in `db/pool.test.js`.
- **One payload per recipient**: `emit()` writes one row **per recipient**, so `dispatchPush` carries `{ userId, notificationId, payload }` triples through to the send. It used to collapse them into a single payload stamped with `rows[0].id`, which meant every recipient after the first received a push carrying **someone else's** notification id. Harmless while nothing read the field back; a cross-user bug the moment anything did. Don't re-flatten it.
- **Durable delivery (outbox — migration 034)**: `afterCommit` is in-process, so a push scheduled but not yet sent is **lost if the container stops** — which is what a redeploy does to every request in flight. Rows are therefore written with `pushed_at = NULL` ("owed") and stamped only once a device has them. `services/notification-maintenance.js` sweeps the owed set every 30s (and 5s after boot) and re-sends. At-least-once: a duplicate collapses under the payload `tag`, a lost one doesn't. Three outcomes, in `notifications.js#classifyDelivery` — delivered (settle), no live device (settle; retrying forever is how the partial index degenerates), transient failure (retry, up to `PUSH_MAX_ATTEMPTS`).
  - When VAPID is unset, `emit` stamps `pushed_at` **at insert time** — otherwise every row in every dev database sits owed forever and the partial index covers the whole table.
  - ⚠️ Multi-instance: each replica runs its own sweep, so a retry can go out N times. Gate the interval behind `pg_try_advisory_lock` before scaling past one container.
- **Dead subscriptions**: a 404/410 from the push service means permanently gone (permission revoked, site data cleared, PWA deleted) → `failed_at` stamped immediately, which removes the row from `loadSubscriptions` (and therefore from every future fan-out). Deleted by the maintenance sweep after a 72h grace window, which is the only way to answer "why did Oktay stop getting pushes?" after the fact; re-subscribing inside the window clears `failed_at` and restores the device. Other errors are transient and leave the row alone.
- **Retention**: nothing pruned notifications before migration 034 and the table grew monotonically (each transition fans out to 2–6 rows). `pruneOldNotifications` deletes read rows after 30 days and everything after 90; `stage_history` remains the actual audit log.
- **Concurrency**: sends run through a bounded worker pool (`MAX_CONCURRENT_SENDS = 12`), not `Promise.all` over every subscription — a bulk approval otherwise fans out to (recipients × devices × notifications) simultaneous HTTPS requests from the process that also serves the API.
- **Mobile only, by choice.** `status: 'desktop'` suppresses both the setup sheet and the bell toggle on laptops/desktops, and `subscribe()` refuses there. Desktop Chrome/Edge support push fine — but push exists to reach people *away* from a screen (the matbaa team on the print floor), and at a desk the app is already open and polling every 15s, so the bell and toasts cover it. All a desktop prompt buys is something to dismiss plus OS banners duplicating a toast already on screen. A desktop that is **already subscribed reports `subscribed`, not `desktop`**, so it keeps working and keeps its toggle — only new setup is suppressed. `isMobileDevice()` is UA + `pointer: coarse` **AND** `maxTouchPoints`; the AND matters, since a touchscreen laptop has touch points but a `fine` primary pointer and must stay desktop.
- **Client**: `hooks/usePushNotifications.js` collapses the whole support chain into one `status` (`unsupported` / `desktop` / `needs-install` / `disabled` / `denied` / `default` / `subscribed`); `components/PushToggle.jsx` renders it in the bell footer and **only ever prompts from a click** (unprompted permission requests get auto-denied by Chrome, and a denial is unrecoverable without system settings). `components/PushBridge.jsx` routes notification taps through React Router. `public/sw.js` is push-only — deliberately **no offline cache**, since a stale pipeline stage shown to a printer is worse than nothing.
- **Tap → screen**: the destination is `link` on the notification row (`buildPayload` falls back to `/projects/<id>`, then `/`), and it rides the push as `url`. `sw.js#notificationclick` delivers it **twice, on purpose**: it `postMessage`s the focused client *and* parks `{url, notificationId}` in IndexedDB (`yz-push`/`handoff`/`pending`). Neither path alone is sufficient — an installed **iOS PWA ignores the URL passed to `openWindow()` and relaunches at `start_url` (`/`)**, and a `postMessage` sent before `PushBridge`'s listener attaches is dropped with no retry. `lib/push-target.js#takePendingPushTarget` reads-and-deletes the parked entry (expiring after 2 min) so whichever path lands first navigates, and the other is a no-op. The drain waits for `isAuthenticated` — consuming a deep link mid-bootstrap gets bounced to `/login` and the target is gone for good.
- **The drain retries; one read is not enough.** On a cold start the worker parks the target long before React mounts, so a single read finds it. On a **warm resume the worker's `notificationclick` and the page waking up are concurrent**, and the page often wins — it reads an empty store, gives up, and the app sits on the screen the *previous* tap opened (the "second notification does nothing" bug). `PushBridge` therefore re-reads on a decaying schedule (`DRAIN_RETRY_MS`, ~1.6s total), cancellable via a token so a `postMessage` that wins — or a navigation the user makes themselves — can't be overridden a second later. It drains on `visibilitychange` **and** `pageshow` **and** window `focus`: bfcache restores skip the first, and a PWA resumed from the app switcher sometimes only fires the last. **`sw.js` ships as a separate static file with its own cache lifetime, so the payload shape and the IndexedDB keys are a wire format between two independently-deployed halves** (`push.test.js` locks the payload side).
- **Links must match the recipient's role.** Most notification targets are `RoleGuard`ed, and a guarded route the recipient can't open silently `<Navigate to="/" replace />`s — the tap looks like it did nothing. `uretime_hazir` therefore emits twice (printers → `/uretime-hazir`, leaders → `/projects/<id>`), and `project_deleted` sets an explicit link for designers/printers (`/projects`) because the `projectId` fallback would otherwise point at a project that now 404s.
- **iOS specifics**: push requires Home Screen install, so `status: 'needs-install'` shows the 4-step install instructions instead of a dead toggle. `apple-touch-icon.png` must be flat RGB (iOS renders alpha as black); `apple-mobile-web-app-capable` and the manifest live in `client/index.html`.
- **Config**: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`. Absent → push self-disables with one warning and the bell feed carries on (the dev default; no keys needed locally). **Rotating the keypair invalidates every stored subscription** — all devices must re-subscribe.

Endpoints: `GET /api/push/public-key`, `POST /api/push/subscribe`, `DELETE /api/push/subscribe`, `POST /api/push/test` (all owner-scoped; `/test` sends the caller a push and returns `{ sent, pruned }`, which is the only practical way to debug a silent delivery chain).
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
- Order eligibility: `assertOrderable(project)` throws 400 if `project.stage ∉ ORDERABLE_STAGES` (`uretime_hazir`/`uretimde`/`gumruk`/`satista`), `has_product_info` isn't set yet, or the product was delisted (`catalog_hidden` — distinct message, see "Kaldırma")
- Handover eligibility: `assertHandoverEligible(project)` throws 400 if the project is not at `uretimde` (TR) / `gumruk` (ÇİN)
- Mock/Infra seam: `infrastructure/config.js` exposes `USE_MOCK`; flipping it to `false` switches repositories from `mock/*` to `http/*` without changing the application or presentation layer.

### Phone layout (the app is used on an iPhone, not only at a desk)
Four rules, each of which was a shipped bug before it was a rule:
- **A single-column grid needs an explicit `grid-cols-1`.** Bare `grid gap-3 md:grid-cols-2` gives the phone an `auto` track, whose floor is the content's *min-content* width — one long project title then pushes the entire page sideways and iOS Safari zooms the whole app out to fit. `grid-cols-1` emits `minmax(0, 1fr)`, which can shrink. Same idea as `min-w-0` on a flex child.
- **Never `w-full` on a flex sibling.** It means 100% of the row *plus* whatever sits beside it. Use `min-w-0 flex-1`.
- **Form controls are 16px on touch (`index.css`, `pointer: coarse`).** Below 16px iOS Safari zooms in on focus and does not zoom back out. Don't "fix" a cramped mobile input by shrinking its font.
- **Full-screen dialogs use `DIALOG_MOBILE_SHEET`** (`components/ui/dialog.jsx`), never a hand-written `max-sm:` chain: `100dvh` (not `h-screen` — `100vh` on iOS excludes the URL bar, so the footer hides behind it) plus the `--safe-top` / `--safe-bottom` insets. The base `DialogContent` is already viewport-capped and scrollable, so short dialogs need nothing.

Bleed utilities (`-mx-*`) must match `<main>`'s gutter, which is `px-3` on phones and `px-4` from `sm`. A horizontal-scroll rail (Kanban) or a `min-w-[860px]` timeline (Yıllık Plan, Dashboard) is fine — page-level horizontal scroll is not. Verify at 390×664 with touch emulation on; note that a Playwright `fullPage` screenshot resets the device-metrics override and silently turns `pointer: coarse` off for every later assertion.
---
## 🚀 Deploy (Dokploy + Dockerfiles)

The app runs as **two services**, each built from its own Dockerfile (Dokploy
Build Pack = Dockerfile) — no Nixpacks. `docker-compose.yml` at the repo root
builds from these same two Dockerfiles for local parity.

- **Frontend** (root [`Dockerfile`](Dockerfile), Build Path `/`): two-stage
  build — installs full workspace deps (incl. devDeps, since Vite needs
  `rollup`), runs `npm run build` to produce `client/dist`, then a slim
  `node:20-alpine` runtime serves it with `serve.cjs` (in-repo zero-dep Node
  http server with SPA fallback + cache headers) on port 3000. Takes
  `VITE_API_BASE_URL` as a **build-time** ARG (Vite only inlines env vars
  present at build time) — Dokploy must pass this as a build arg or the
  bundle ships with no API base URL.
- **Backend** ([`server/Dockerfile`](server/Dockerfile), Build Path
  `/server`): two-stage build — `npm ci --omit=dev` for prod-only deps, then
  a slim runtime copies in the source tree and runs via
  `docker-entrypoint.sh`. The entrypoint starts as root just long enough to
  chown the persistent upload dir, then `exec`s into the unprivileged `node`
  user so Fastify never runs as root and still receives SIGTERM as PID 1.
  Binds `PORT` (default 4000); on boot it auto-applies pending migrations and
  optionally seeds when `SEED_ON_BOOT=true`. Ships a container `HEALTHCHECK`
  against `GET /api/health`.
- **Dokploy pairing**: deploy twice — once per Dockerfile — and point the
  frontend's `VITE_API_BASE_URL` build arg at the backend's URL. The SPA
  always talks to its own `/api` prefix; Vite proxies to `localhost:4000`
  in dev.
- **Env vars**: see `.env.example` for both surfaces.

---

## 🚀 Production Checklist
- [x] Postgres schema + migrations (runner in `server/src/services/migrate.js`)
- [x] Fastify server (`server/src/index.js`) — X-User-Id trusted header auth
- [x] HTTP repositories behind the same ports the mock uses (`client/src/infrastructure/http/repositories/`)
- [x] Transport switch (`USE_MOCK` env override `VITE_USE_MOCK`)
- [x] Local dev parity (`docker-compose.yml`)
- [x] Migration runner (idempotent, plain SQL files)
- [x] Seed with the same data the SPA was built around
- [x] Web push delivery (migration 032) — server + SW + client toggle shipped
- [ ] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` set in Dokploy (push is inert until then)
- [ ] Push verified on a real iPhone (Home Screen install) and a real Android device
- [ ] OAuth app registered in Google Cloud Console (client ID + secret in .env)
- [ ] Session cookie: httpOnly, sameSite=strict, secure=true in production
- [ ] Redis session TTL set to 7 days; auto-refresh on activity
- [ ] Role middleware on every protected Fastify route (currently header + ad-hoc checks)
- [ ] Fastify JSON schema validation on all POST/PATCH inputs
- [ ] Rate limiting via Redis on auth + sensitive routes
- [ ] Invitation flow: add email to allowlist in DB → user signs in via OAuth
- [ ] File uploads: type + size validated
- [ ] `.env` never committed
- [ ] CORS locked to production domain
- [ ] DB connection pool max 10 — currently configurable via `PG_POOL_MAX`
- [ ] Redis connection with retry + reconnect strategy
- [ ] Stage / approval flows double-checked against `client/src/infrastructure/mock/helpers/project-transitions.js`

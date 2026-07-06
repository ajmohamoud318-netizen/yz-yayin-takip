# YZ Yayın Takip — Project Passes (Discovery Notes)

> How a book actually moves through the company. Captured from discovery with the team.
> A **book = a project**. It does not die when it ships — the same project can loop
> through the pipeline multiple times. Each trip is a **pass**.

---

## Core model

- Every book is a single, permanent project (one identity, full history).
- A project lives through one or more **passes** through the pipeline.
- At any time the system holds projects in all states at once: newly added,
  ongoing, completed/selling, and re-entering (reprint or redesign).
- **Demo** = a design-phase checkpoint (can be rejected back for redesign).
- **Özalit** = a print-proof checkpoint (no demo involved).
- Every rejection increments a counter: Demo 1, Demo 2… / Özalit 1, Özalit 2…

## The three functions

- **Designer(s)** — produce the book (cover, content, etc.).
- **Matbaa (printer)** — produces demos and özalits (teslim), then prints.
- **Sales** — pulls demand; requests a book for a sale/print run.
- **Ayşenur (team leader)** — the only one who creates projects, assigns work,
  and approves/rejects at every gate.

---

## Pass 1 — First Edition (idea → selling)

**Creation (Ayşenur only)**
- She creates the project: title, type (TR / ÇİN), target month.
- She picks which subtasks apply: Kapak, Kutu, Ses, Video/Animasyon, Yazılım,
  İçerik/Görsel, Sayfa Sayısı (numeric).
- She assigns the project to **one or more designers**, and assigns **each
  subtask to a specific designer** (she controls the division of labor).

**Flow**

1. **Tasarım** — assigned designers work on their subtasks.
2. **Demo** — designer *or* team leader can request a demo **at any time, even
   before the book is complete** → Matbaa produces it and delivers (teslim) →
   Ayşenur approves or rejects.
   - Reject → back to the assigned designer(s) for redesign → another demo (Demo 2, 3…).
   - Approve **and** project is 100% complete → proceed to Özalit #1.
3. **Özalit #1 (to become production-ready)** — requested once the project is
   complete and a demo was approved earlier. **No demo involved.** Matbaa teslim →
   Ayşenur approves/rejects.
   - Reject → another özalit (Özalit 2, 3…).
   - Approve → **production-ready**.
4. **Production-ready (`uretime_hazir`)** — the book sits, available.
5. **Into production & selling** — the printer takes it into production
   ("Üretime Al" → `uretimde`), then raises a **handover (teslim)** which Sales
   confirms ("Alındı") → **Satışta** (selling). Pass 1 closes.

**Notes / rules confirmed**
- Demo can be requested mid-design; özalit cannot — özalit only after completion.
- Özalit #1 is requested by the team leader.
- Özalit never involves a demo.

> **Implementation note (resolved).** These discovery notes originally described
> the first edition being *ordered by Sales* out of `uretime_hazir`, with a
> designer-initiated **Özalit #2** before production. The app does **not** work
> that way, and we chose to keep the app's flow: a first edition reaches
> `satışta` through the **printer + handover** path above — there is no first-run
> Sales order and no Özalit #2. Sales **orders** exist only for **Pass 2+**
> (reprints), which is why `ORDERABLE_STAGES = { satışta }`. The designer-initiated
> özalit lives in the Pass 2 reprint loop below.

---

## Pass 2 — Reprint / Resell (existing book, another run)

Triggered when a book that's already finished/selling needs another run. No new
design phase, **no demo** — same shape as the sales-pull step of Pass 1.

1. **Sales requests** a reprint of an existing book → Ayşenur is notified.
2. She assigns a **check** to the original designer(s) *or* different ones.
3. The designer reviews the project; if design changes are needed they make them,
   then **requests Özalit** (designer-initiated).
4. Matbaa teslim → Ayşenur approves/rejects → loop until approved (Özalit 2, 3…).
5. **Production → Satışta.**

**Notes**
- Every reprint must go through özalit (no straight-to-print).
- **Redesign is not a separate pass** — it happens inside this Pass 2 check: during
  the review the designer can make whatever design changes are needed before
  requesting özalit. Small tweak or larger rework, it's the same flow.

---

## Gaps between this model and the current app — steps to resolve

> Findings from reading the client code (`domain/`, `application/`, mock repos).
> Ordered by importance. Each is a step we still need to decide on / build.

**Step 1 — Make a project a repeatable loop (passes). ✅ DONE**
Today a project has one `stage` and only moves forward; once `satışta` it can't
re-enter. Add a "pass" concept so the same book can go around again (reprint or
redesign). Needs: a current-pass pointer + a place to store each completed pass.
*This is the core of Pass 2 and the biggest gap.*

**Step 2 — Record real history instead of faking it. ✅ DONE (mock layer)**
Seed projects' timelines are invented at render time (`generateHistory` makes up
dates, reasons, names). Switch to a real append-only history log so every demo,
özalit, approval, and rejection is actual recorded data — the audit trail your
"pipeline trust" principle depends on.

**Step 3 — Fix rejection routing. ✅ DONE**
All rejections currently send the project back to `tasarim`. An **özalit**
rejection should loop as another özalit (Özalit 2, 3…), not throw the book back
to design. Keep the counters (they already work); fix where the stage lands.

**Step 4 — Add a reject loop to the sales-side özalit. ✅ DONE**
The sales pull (order workflow: talep → designer → matbaa → onay) only moves
forward — there's no reject path. Add approve/**reject** so the sales özalit can
be rejected and re-requested (Step 3's looping applies here too).

**Step 5 — Wire up the Sales role. ✅ DONE**
Confirmed Sales (`satis`) drives the workflow end to end: logs in → lands on
Sipariş Talebi → can pick finished books → request carries the Sales user →
reprint reopens a pass → routes to the team leader as `pending`. Added: at the
assign step the team leader now picks the designer(s) for the check (original or
different), which updates the project's designers for that pass.
The app has **four roles**: `team_leader`, `designer`, `printer`, and `satis`
(Sales — Esra Kılıçkan has a login). So Sales already exists. The open question is
how much of the sales/reprint workflow is actually driven by the `satis` role —
confirm Sales can log in, request a run/reprint, and that it routes to Ayşenur.

**Step 6 — Clean up "demo anytime". ✅ DONE (light cleanup)**
Finding: demo-before-complete already worked (no progress gate on demo_teslim);
the real issue was two parallel representations — a decorative `demo_requested`
flag AND the demo_teslim/demo_onay stages. Decision: keep the stages as the single
representation; requesting a demo now = sending it to Matbaa (advance to
demo_teslim). Removed the `demo_requested` flag, `requestDemo`, and the dialog's
'request' mode. One demo action, one representation.

**Step 7 — Verify multi-designer in the UI. ✅ DONE**
Confirmed: the New Project dialog fully exposes it — multi-select designer
checkboxes, and when >1 designer is assigned each checked subtask gets a
"pick designer" dropdown (sent as `assignees[]` + `subtaskAssignees`, prefilled in
edit mode). The data model already supported it; only seed data didn't exercise
it. Seeded two multi-designer projects: p-x16 (in design, per-subtask split across
Feyza + Nur) and p-x17 (Aylin + Sümeyye). Bumped the mock storage key to v7 so the
new seed + all model changes take effect.

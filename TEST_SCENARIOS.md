# Test Scenarios — YZ Yayın Takip

> QA checklist covering every user-facing and API scenario in the app, derived
> from `AGENTS.md`, `CLAUDE.md`, and the current server implementation
> (`server/src/routes/*.js`, `server/src/schemas/index.js`,
> `server/src/middleware/auth.js`, `server/db/migrations/*.sql`). Grouped by
> feature area; each item is a single scenario to click through (or automate)
> and its expected result. Update this file whenever a rule in `AGENTS.md`
> changes — it should never drift from the pipeline it documents.

Roles referenced below: **TL** = team_leader, **D** = designer, **P** =
printer/Matbaa, **S** = satis/Sales.

---
## 1. Authentication & Sessions

### 1.1 Login (`POST /api/auth/login`)
- [ ] Valid email + correct password → 200, session cookie set (httpOnly), `{ user }` returned, password hash never in response.
- [ ] Valid email + wrong password → 401 "E-posta veya şifre hatalı." (no hint about which field was wrong).
- [ ] Unknown email → 401, same generic message (no user enumeration).
- [ ] Deactivated user, correct password → 403 "Hesabınız devre dışı bırakılmış."
- [ ] User with no password yet (invited, never accepted) → 401 "Şifre tanımlı değil."
- [ ] Missing `email` or `password` in body → 400 schema validation error.
- [ ] `email` not a valid email format → 400.
- [ ] Password field empty string → 400 (`minLength: 1`).
- [ ] Extra/unknown body field (`additionalProperties: false`) → 400.
- [ ] Email with mixed case / surrounding whitespace → still matches (server lowercases + trims before lookup).
- [ ] 11th login attempt within 5 min from same IP → 429 rate-limited, regardless of email.
- [ ] 11th login attempt within 5 min against same email from *different* IPs → 429 (per-email bucket).
- [ ] After rate-limit window passes → login works again.
- [ ] Successful login while an old session cookie (different user) is present → new cookie replaces it, new user active.

### 1.2 Logout (`POST /api/auth/logout`)
- [ ] Logout with valid session cookie → session deleted server-side, cookie cleared, subsequent `/me` call 401.
- [ ] Logout with no cookie present → still 200 `{ ok: true }` (idempotent, no crash).
- [ ] Logout with an already-expired/invalid cookie → 200, no error.
- [ ] After logout, the old cookie value (if replayed) is rejected — not just "logically expired" client-side.

### 1.3 Session / `X-User-Id` header fallback
- [ ] Dev/test env with `TRUST_HEADER_AUTH=true`: request with only `X-User-Id` header (no cookie) succeeds for an active user.
- [ ] Same, but user is deactivated → 403.
- [ ] Same, but user id doesn't exist → 401.
- [ ] Production config (`TRUST_HEADER_AUTH=false`): request with only `X-User-Id`, no cookie → 401, header ignored entirely.
- [ ] Cookie present but expired/revoked AND header fallback disabled → 401 (no silent fallback in prod).
- [ ] Cookie present and valid, header also present with a *different* user id → cookie identity wins (header never consulted once cookie resolves).
- [ ] No cookie, no header → 401 "Oturum geçersiz — lütfen yeniden giriş yapın", SPA bounces to `/login`.

### 1.4 Forgot / Reset password
- [ ] `POST /auth/forgot-password` with a real, active email → 200 `{ ok: true }`, reset email sent with 1-hour token.
- [ ] Same, with unknown email → 200 `{ ok: true }` (identical response — no enumeration), no email sent.
- [ ] Same, with a deactivated user's email → 200 `{ ok: true }`, no email sent (guarded by `is_active !== false`).
- [ ] 6th forgot-password request in 1 minute from same IP → 429.
- [ ] Malformed email (not email format) → 400.
- [ ] Reset link token used within validity window + valid new password (≥8 chars) → 200, password updated, session issued (auto sign-in), all *other* existing sessions for that user invalidated.
- [ ] Reset token used twice → second use fails (410/expired — one-shot token).
- [ ] Reset token past expiry → rejected (expired).
- [ ] Reset token that never existed / garbage string → rejected, no 500.
- [ ] New password < 8 chars → 400 schema validation, token NOT consumed (can retry with a valid password using the same link).
- [ ] Reset-password endpoint hit 21 times in 15 min (same token or same IP) → 429.
- [ ] After reset-password, logging in with the OLD password fails; logging in with the NEW password succeeds.
- [ ] After reset-password, a previously-open browser tab's old session cookie is now invalid (forced logout elsewhere).

### 1.5 Change password (`PATCH /auth/change-password`, authenticated)
- [ ] Correct current password + valid new password → 200, password rotated.
- [ ] Wrong current password → 401 "Mevcut şifre yanlış."
- [ ] New password identical to current password → 400 "Yeni şifre mevcut şifreden farklı olmalı."
- [ ] New password < 8 chars → 400 schema validation.
- [ ] Account with NO password yet (never accepted invite, hit this endpoint directly) → current-password check skipped, new password set.
- [ ] Deactivated account attempts change-password → 403.
- [ ] Not authenticated (no session) → 401 before any DB check.

### 1.6 Invitation flow (accept-invite)
- [ ] `GET /auth/invite-preview?token=...` valid, unused, unexpired token → 200 `{ name, email, role, expiresAt }`, token NOT consumed.
- [ ] Same endpoint with expired token → 410/error, distinct from "unknown token" so UI can show the right message.
- [ ] Same endpoint with unknown/garbage token → 404.
- [ ] `POST /auth/accept-invite` with valid token + password ≥8 chars → 200, password set, `joined_at` stamped (only if previously null), invitation marked used, session issued (auto sign-in), redirected into the app.
- [ ] Same token replayed after being consumed → rejected (already used).
- [ ] Password < 8 chars on accept-invite → 400, token not consumed.
- [ ] 21st accept-invite attempt in 15 min from one IP (mix of valid/garbage tokens) → 429.
- [ ] 21st attempt against the *same* token in 15 min → 429 (per-token bucket, brute-force protection).
- [ ] Accepting an invite for a role-specific account lands the user on that role's default page after auto sign-in (designer → My Projects, printer → Onaylar, satis → Sipariş Talebi).

### 1.7 Dev-login (`POST /auth/dev-login`, non-production only)
- [ ] `NODE_ENV=production` → always 401 "Dev login disabled in production", regardless of body.
- [ ] Non-production + valid, active `user_id` → 200, session cookie issued.
- [ ] Non-production + unknown `user_id` → 401 "Unknown user".
- [ ] Non-production + deactivated `user_id` → 403.

---
## 2. User Management (`/api/users*`, team_leader only unless noted)

- [ ] `GET /users` as team_leader → full roster including `email`, `is_active`, invited/joined timestamps, today's `daily_status` + `work_log_today`.
- [ ] `GET /users` as a non-leader role (designer/printer/satis) → 200, but with the **minimal** shape only: `{ id, name, role, is_active }` — no `email`, `invited_at`, `joined_at`, `daily_status`, or `work_log_today` leaked to non-leaders. (Fixed: the route can't be team_leader-only outright since assignee-name lookups on project cards depend on it for every role; it's column-scoped by caller role instead.)
- [ ] `POST /users/invite` as non-team_leader → 403.
- [ ] Invite a brand-new email with role `designer`/`printer`/`satis` → 201-ish, user row created with no password, invitation email sent, response includes `invitation.url`/`token`/`expiresAt`.
- [ ] Invite with role `team_leader` → 400 (schema enum excludes `team_leader`; only the three subordinate roles may be invited).
- [ ] Invite an email that already belongs to an **active** user → 409 "Bu e-posta zaten kayıtlı."
- [ ] Invite an email that belongs to a **deactivated** user → reactivates them in place, updates name/role, mints a fresh invite token, returns `reactivated: true` — does NOT create a duplicate row.
- [ ] Invite with missing name/email/role → 400.
- [ ] Invite with malformed email → 400.
- [ ] Mail provider outage during invite → invite still succeeds (user + token created), response surfaces `emailError`, caller can forward the URL manually.
- [ ] 31st invite in 1 hour from same IP → 429.
- [ ] `PATCH /users/:id/deactivate` on another user by TL → 200, `is_active=false`; that user's next request (cookie or header) → 403.
- [ ] TL attempts to deactivate **themselves** → 403 "Kendinizi devre dışı bırakamazsınız."
- [ ] TL attempts to deactivate the **last active team_leader** (another TL, but they're the only one left) → 403 "Son aktif takım liderini devre dışı bırakamazsınız."
- [ ] Deactivating a team_leader when a pending Özalit approval only needed that leader's sign-off → deactivation succeeds AND `reconcileOzalitApprovals` runs, potentially auto-advancing the stuck project so it isn't stranded waiting on a leader who lost access.
- [ ] Deactivate unknown user id → 404.
- [ ] `PATCH /users/:id/reactivate` on a deactivated user → 200, `is_active=true`, they can log in again.
- [ ] Reactivate an already-active user → 200 no-op (idempotent).
- [ ] Reactivate unknown id → 404.
- [ ] `DELETE /users/:id` (hard delete) by TL → 204; invitations/password-resets cascade-delete; that user's projects/subtasks/history/orders/handovers keep existing rows with the assignee FK set to NULL (no orphan-crash); avatar file removed from disk.
- [ ] Delete self → 403 "Kendinizi silemezsiniz."
- [ ] Delete the last active team_leader → 403, same last-leader protection as deactivate.
- [ ] Delete unknown id → 404.
- [ ] Avatar file missing on disk when deleting the user → delete still succeeds (best-effort cleanup, warning logged, not a failure).
- [ ] Non-team_leader hits any of invite/deactivate/reactivate/delete → 403 for all.

### 2.1 Avatar upload (`/users/me/avatar*`)
- [ ] Upload a valid JPEG/PNG/WebP under 2 MB → 200 `{ avatarUrl }`, `avatar_updated_at` stamped.
- [ ] Upload a file whose declared mimetype is image/png but bytes are NOT a real PNG (e.g. renamed script/HTML/SVG) → 400 "Dosya içeriği geçerli bir görüntü değil" (content-sniff catches mismatched/spoofed mimetype).
- [ ] Upload declared type not in the allow-list (e.g. `image/gif`, `application/pdf`) → 400 "Desteklenen formatlar: JPEG, PNG, WebP."
- [ ] Upload > 2 MB → 400 "Dosya 2 MB sınırını aşıyor." (aborted mid-stream, not after full buffering).
- [ ] No file in the multipart body → 400 "Dosya bulunamadı."
- [ ] Upload while unauthenticated → 401.
- [ ] Re-upload replaces the previous avatar (old file cleaned up, not orphaned).
- [ ] `DELETE /users/me/avatar` removes file + clears `avatar_url`/`avatar_updated_at` → 200.
- [ ] Delete avatar when none exists → still 200 (idempotent), no crash.
- [ ] `GET /users/:id/avatar/file` for a user with no avatar → 404 "Avatar bulunamadı." (public route, no auth required — confirm no sensitive data leaks via this path for an arbitrary `:id`).
- [ ] `GET /users/:id/avatar/file` for a user whose DB row has a URL but the file is missing on disk → 404 "Avatar dosyası eksik." (not a 500).
- [ ] `GET /users/me/avatar/file` without auth → 401 (unlike the public `:id` route, this one requires `attachUser`).
- [ ] Cache-Control header present (`private, max-age=300`) on both avatar file routes.

---
## 3. Projects — CRUD

- [ ] `POST /projects` as team_leader with title + type (`TR`|`CIN`) + subtasks + assignees → 201, project created at stage `tasarim`, progress 0.
- [ ] Same as designer/printer/satis → 403 (team_leader only).
- [ ] Missing `title` or `type` → 400.
- [ ] `type` outside `TR`/`CIN` → 400.
- [ ] `target_month` not `YYYY-MM-01` shaped string → 400; `null` accepted.
- [ ] `pass_kind` outside `first_edition`/`reprint`/`redesign` → 400.
- [ ] `assignees` array with > 8 entries → 400.
- [ ] `subtasks` array with > 32 entries → 400.
- [ ] Multiple assignees supplied → first becomes the project's primary `assigned_to`; the rest distributed via `subtaskAssignees` to specific subtasks.
- [ ] Subtask `kind: 'pages'` without `total_pages` vs. with a valid `total_pages` → both accepted (nullable); `total_pages` ≤ 0 or > 100000 → 400.
- [ ] Subtask `kind: 'sticker-count'` mirrors the pages behavior with `total_stickers`.
- [ ] Create project → assigned designer receives an "assignment" notification; team leader is not notified of their own action.
- [ ] `GET /projects` filters by `type`, `stage`, `month`, `assigned_to` individually and combined — verify each filter narrows correctly and unknown filter values return an empty set rather than erroring.
- [ ] `GET /projects/:id` returns subtasks + full stage history for a valid id; unknown id → 404.
- [ ] `PATCH /projects/:id` (title/assigned_to/target_month) as team_leader → 200, only the four writable columns applied even if extra recognized keys are sent (e.g. `pageCount`, `stickerCount` — accepted by schema but only certain columns actually persist; verify silently-ignored fields don't error).
- [ ] `PATCH /projects/:id` as non-team_leader → 403.
- [ ] `PATCH` with an empty body (`{}`) → 400 (`minProperties: 1`).
- [ ] `PATCH` with an unknown extra key → 400 (`additionalProperties:false` catches typos).
- [ ] Reassigning `assigned_to` to a different designer → new designer notified; old designer's "My Projects" list no longer shows it.
- [ ] `DELETE /projects/:id` as team_leader → cascades subtasks/demos/stage_history/orders/handovers for that project.
- [ ] `DELETE /projects/:id` as non-team_leader → 403.
- [ ] Delete unknown project id → 404.

---
## 4. Subtasks & Progress

- [ ] `PATCH /subtasks/:id` `{ is_done: true }` by the assigned designer → subtask flips, project `progress` recalculated server-side (completed/total × 100).
- [ ] Un-checking a subtask (`is_done: false`) after 100% → progress drops below 100% again; if the project already advanced past the gate (e.g. sits at `ozalit_teslim`), verify the UI/backend doesn't silently regress the stage — confirm intended behavior (should the project be blocked from re-entering production stages, or is history immutable once advanced?).
- [ ] `pages_done` update on a `kind:'pages'` subtask, value within `[0, total_pages]` → accepted; value > `total_pages` → 400 "Sayfa sayısı toplam sayfa sayısını (N) aşamaz." (Fixed: route now validates against the subtask's own `total_pages`, not just the schema's generic 0–100000 bound.)
- [ ] `stickers_done` mirrors the pages case for `kind:'sticker-count'` → 400 "Etiket sayısı toplam etiket sayısını (N) aşamaz." when it exceeds `total_stickers`.
- [ ] Empty PATCH body → 400 (`minProperties: 1`).
- [ ] PATCH by a designer NOT assigned to this subtask/project → verify server rejects (ownership check) rather than trusting client-side hiding of the control.
- [ ] `POST /subtasks/:id/updates` with a note (1–5000 chars) → appended to that subtask's timeline; empty note → 400.
- [ ] `PUT /projects/:id/subtasks` (team_leader) replaces the whole subtask list — verify existing progress/done state of subtasks that persist by title is preserved vs. reset, and that removing a subtask that's already done recalculates progress correctly.
- [ ] `PUT` subtask list with per-subtask `assigned_to` differing from the project's primary designer → that subtask's owner sees it in their queue independent of the project-level assignee.
- [ ] `PUT` with > 64 subtasks → 400.
- [ ] Revize flow: team leader marks specific `revizeIds` in a rejection → only those subtasks are flagged for rework, not the whole subtask set.

---
## 5. TR Pipeline — Stage Transitions

- [ ] New TR project starts at `tasarim`, 0% progress, assigned designer sees it in "My Projects".
- [ ] Designer checks off subtasks incrementally → progress % climbs; no stage change until 100%.
- [ ] Progress hits 100% at `tasarim` → team_leader + printer notified (no stage change yet — 100% just unlocks the ability to demo/advance, per AGENTS.md "notifies Ayşenur + Oktay").
- [ ] Designer (or TL) requests a demo at ANY progress (not just 100%) → `tasarim → demo_teslim`.
- [ ] Attempt to request a second demo while one is already in flight (`stage ∈ {demo_teslim, demo_onay}`) → rejected/blocked — no duplicate demo requests.
- [ ] Printer delivers the demo: `POST /advance` at `demo_teslim` → `demo_onay`. Attempting this as a non-printer → 403.
- [ ] TL approves demo at `demo_onay` with progress = 100% → advances to `ozalit_teslim`.
- [ ] TL approves demo at `demo_onay` with progress < 100% → **held**: stays at `demo_onay`, `demo_held=true`, UI shows the "Tasarım tamamlanmadı" hint; does NOT advance to Özalit.
- [ ] TL rejects demo → `reason` required (missing → 400); `demo_attempt` increments; project routes back to `tasarim`.
- [ ] Reject demo with empty/whitespace-only reason → 400.
- [ ] Reject demo without `stage` in body → 400.
- [ ] Non-team_leader attempts `/reject` → 403 (reject is TL-only at every stage).
- [ ] After a held approval, designer (or TL) sends a **second demo** ("Demo İste") at any progress/held-state → server's re-send branch moves `demo_onay → demo_teslim` directly (skips back through `tasarim`), bumps `demo_attempt` again.
- [ ] Full second demo loop repeats (`demo_teslim → demo_onay`); TL approves again at 100% → now genuinely advances to `ozalit_teslim`.
- [ ] Attempt to advance `ozalit_teslim → ozalit_onay` (or any Özalit+ stage) while progress < 100% → 400 from `assertCanEnterProduction`, regardless of role.
- [ ] Printer delivers Özalit (`ozalit_teslim → ozalit_onay`) as non-printer → 403.
- [ ] TL approves Özalit → `uretime_hazir`. Single-step approval (no printer/second-approver step here, unlike demo).
- [ ] TL rejects Özalit with `reject_target: 'matbaa'` → loops back for matbaa to re-deliver ozalit (skips designer rework).
- [ ] TL rejects Özalit with `reject_target: 'designer'` → routes back to `tasarim` for rework first; `ozalit_attempt` increments.
- [ ] Reject Özalit with a `reject_target` value outside `{matbaa, designer, reassign}` → 400 (schema enum).
- [ ] Reject Özalit with NO `reject_target` — verify server has a sane default or explicitly requires it for this stage only (not required at demo rejection).
- [ ] `uretime_hazir → uretimde` transition — verify who can trigger it (printer, per file structure `UretimeHazir.jsx`) and that it's blocked below 100% progress (already guaranteed since gate already passed once, but re-verify no regression path exists).
- [ ] At `uretimde`, printer raises a **handover** request (see §7) → confirmed by Sales → project moves to `satista`.
- [ ] Full happy-path TR project: create → subtasks 100% → demo → approve at 100% (no hold) → özalit → approve → üretime hazır → üretimde → handover → satista. Confirm stage_history has one row per transition with correct `action` (`advance`/`approve`/`reject`) and `done_by`.

---
## 6. ÇİN Pipeline — Stage Transitions

- [ ] New ÇİN project starts at `tasarim`; same subtask/progress mechanics as TR.
- [ ] Progress hits 100% → only team_leader notified (per AGENTS.md — no Oktay/printer ping at this point for ÇİN, unlike TR).
- [ ] Demo request → `tasarim → cin_demo_teslim` (not the TR `demo_teslim` stage — verify no cross-contamination between the two demo stage names).
- [ ] No second demo request allowed while `stage ∈ {cin_demo_teslim, cin_demo_onay}`.
- [ ] Printer or TL delivers `cin_demo_teslim → cin_demo_onay` — verify exact allowed role per AGENTS.md ("Ayşenur OR Oktay approves" refers to *approval*, confirm who delivers).
- [ ] Approval at `cin_demo_onay` with 100% progress → advances straight to `uretime_hazir` (ÇİN skips Özalit entirely — confirm this asymmetry vs. TR is respected everywhere, including notifications and dashboard grouping).
- [ ] Approval at `cin_demo_onay` with < 100% progress → held, same `demo_held=true` semantics as TR.
- [ ] Rejection at `cin_demo_onay` → reason required, `demo_attempt` increments, back to `tasarim`.
- [ ] Re-send demo after a held ÇİN approval → `cin_demo_onay → cin_demo_teslim` directly (mirrors the TR re-send branch, different stage names).
- [ ] `uretime_hazir → uretimde → gumruk → satista` progression — verify a TR project can never reach `gumruk` and a ÇİN project can never reach `ozalit_teslim`/`ozalit_onay` (stage enum allows both sets globally; confirm application-level pipeline logic, not just DB CHECK, prevents illegal cross-pipeline stage assignment).
- [ ] At `gumruk`, printer raises handover (per `HANDOVER_ELIGIBLE_STAGE.CIN = 'gumruk'`) → Sales confirms → `satista`.
- [ ] Attempt to raise a handover for a ÇİN project still at `uretimde` (i.e. before customs) → rejected — TR's eligible stage is `uretimde`, not ÇİN's.
- [ ] Full happy-path ÇİN project end to end, confirming stage_history correctness as in §5's final item.

---
## 7. Production Gate & Cross-Cutting Pipeline Rules

- [ ] `assertCanEnterProduction` blocks entry to `ozalit_teslim`, `ozalit_onay`, `uretime_hazir`, `uretimde`, `gumruk`, `satista` when progress < 100%, for BOTH advance and approve actions, regardless of caller role.
- [ ] Demo stages (`demo_teslim`, `demo_onay`, `cin_demo_teslim`, `cin_demo_onay`) are explicitly exempt from the gate — demo can be requested/delivered/approved at any progress (approval below 100% just holds rather than blocking outright).
- [ ] Attempting to skip stages directly (e.g. calling `/approve` with a `stage` far ahead of the project's current stage) → rejected — transitions must be sequential, not jumpable via a crafted request body.
- [ ] Every reject (any stage) without a `reason` → 400, enforced by schema (`required: ['stage','reason']`) AND presumably by domain logic — verify both layers agree.
- [ ] `reason` at max length (2000 chars) accepted; 2001 chars → 400.
- [ ] `demo_attempt` / `ozalit_attempt` visibly increments on the project detail / history view after each rejection (Demo 1, Demo 2, Demo 3, …) — verify the UI counter and the DB counter never diverge.
- [ ] Non-team_leader calling `/reject` at ANY stage → 403 (reject is exclusively team_leader across the whole pipeline, not just some stages).
- [ ] `/advance` and `/approve` called by a role with no permission for that specific stage (e.g. designer trying to deliver a printer-only demo) → 403.
- [ ] Direct `PATCH` on a project's `stage` field (bypassing `/advance`/`/approve`/`/reject`) is not exposed by any route — confirm there is no accidental way to set `stage` via `PATCH /projects/:id` (schema for `projectsPatch` should NOT include `stage` in its properties — verify).
- [ ] `note` field (optional, ≤1000 chars) on advance/approve is stored and shown in history when present; omitted → no error.

---
## 8. Sipariş (Order) Mini-Workflow

- [ ] `POST /orders` (satis) for a project at `uretime_hazir`/`uretimde`/`gumruk`/`satista` WITH a saved `has_product_info` entry → 201, order created at `pending`.
- [ ] Same, but project stage is `tasarim`/any pre-production stage → 400 (`assertOrderable` — not in `ORDERABLE_STAGES`).
- [ ] Same, but project has never had product info saved (`has_product_info` unset) → 400, even if the stage is otherwise eligible.
- [ ] `POST /orders` as a non-satis role → 403.
- [ ] `quantity` ≤ 0 or > 1,000,000 → 400; omitted → accepted (optional).
- [ ] `notes` > 2000 chars → 400.
- [ ] Order created → team_leader notified of new sipariş talep step.
- [ ] `PATCH /orders/:id/advance` `pending → goruldu` by team_leader → designer(s) notified.
- [ ] `PATCH /orders/:id/advance` at each subsequent step performed by anyone OTHER than the step's `ORDER_STEP_OWNER` → 403 (e.g. designer trying to advance `matbaa_onay`, which belongs to team_leader).
- [ ] `goruldu → tasarimci_onay` by designer confirming work → printer notified.
- [ ] `tasarimci_onay → matbaa_onay` by printer delivering ozalit → team_leader notified.
- [ ] `matbaa_onay → onaylandi` by team_leader approving → satis (requester) notified "Talebiniz onaylandı — üretime alındı".
- [ ] `expectedVersion` mismatch on advance (optimistic concurrency — someone else already advanced this order) → conflict response, not a silent overwrite; verify the client surfaces "someone else updated this" rather than clobbering.
- [ ] `assignees` array > 8 → 400 on advance.
- [ ] `PATCH /orders/:id/reject` at `matbaa_onay` with `rejectTarget: 'designer'` vs `'matbaa'` → routes back to the correct owner, mirroring the main pipeline's ozalit rejection choice.
- [ ] Reject without `reason` → 400.
- [ ] Reject as non-team_leader → 403.
- [ ] `GET /orders` — verify per-role default filters (e.g. designer sees orders at `goruldu` assigned to them; satis sees their own requests; printer sees `tasarimci_onay`/`matbaa_onay`) each return the correct subset and nothing outside their concern.
- [ ] Multiple sipariş cycles on the SAME project (re-print requested twice) → each is an independent `order_requests` row; confirm the project's main pipeline `stage` is untouched by order cycling (orders are additive, not a stage regression).
- [ ] Ürünler catalog page correctly splits eligible projects into "Sipariş İçin Hazır" (`uretime_hazir`/`uretimde`/`gumruk`) vs. "Halihazırda Satışta" (`satista`).

---
## 9. Teslim (Handover) Workflow

- [ ] `POST /handovers` (printer) for a TR project at `uretimde` → 201, `pending`.
- [ ] Same for a ÇİN project at `gumruk` → 201, `pending`.
- [ ] TR project NOT at `uretimde` (e.g. still `uretime_hazir` or already `satista`) → 400 `assertHandoverEligible`.
- [ ] ÇİN project at `uretimde` (not yet `gumruk`) → 400 — TR's eligible stage must not leak into ÇİN's check.
- [ ] `POST /handovers` as non-printer → 403.
- [ ] Duplicate handover request for the same project while one is already `pending` — verify whether a second request is blocked or silently allowed (potential double-handover bug if not guarded).
- [ ] Handover created → satis notified (pending confirmation).
- [ ] `PATCH /handovers/:id/confirm` (satis) → `confirmed`, project moves to `satista`; the requesting printer is notified their request was approved (green notification, per AGENTS.md).
- [ ] Confirm as non-satis role → 403.
- [ ] Confirm an already-confirmed handover (double-click / replay) → verify idempotent 200 or clean error, not a duplicate `satista` transition / duplicate notification.
- [ ] Confirm an unknown handover id → 404.
- [ ] `GET /handovers` — printer sees their raised requests + status; satis sees pending ones needing confirmation — verify per-role scoping.

---
## 10. Notifications

- [ ] Every stage transition (advance/approve/reject), order step, and handover event writes both a `stage_history`/order row AND a `notifications` row in the SAME transaction — kill the server mid-request (or simulate a failure) and confirm there's never a transition recorded with no corresponding notification (or vice versa).
- [ ] The actor who performed an action is never notified of their own action (e.g. TL approving doesn't notify TL).
- [ ] Recipients are resolved against the **active** user set only — a deactivated designer's old assignment doesn't get a new notification after they're deactivated.
- [ ] `GET /notifications` returns up to 50 items plus `unread` and `unseen` counts for the current user only (never another user's notifications, even via a crafted request).
- [ ] `GET /notifications/unread-count` matches the count implied by the full list.
- [ ] Opening the bell dropdown clears `seen` (badge disappears) but items remain un-bold until individually clicked.
- [ ] Clicking a single notification clears both `is_read` and `seen` for that item (read implies seen), navigates to its `link`.
- [ ] `POST /notifications/read-all` clears `is_read` (and `seen`) for ALL of the current user's notifications, returns the count affected.
- [ ] `POST /notifications/seen` clears only `seen` (badge) for all, leaving bold/unread state intact.
- [ ] `PATCH /notifications/:id/read` for a notification belonging to ANOTHER user → 403/404 (owner-scoped; verify no IDOR by guessing another user's notification id).
- [ ] Polling (`useNotifications`, every 15s) continues to reflect new events without requiring a page refresh — verify a stage change made by another user's session shows up within ~15s.
- [ ] Notification `tone` (amber/green/rose/blue/pink) renders the correct icon/color per `type` in the bell.
- [ ] Notification tied to a now-deleted project (`project_id` FK `ON DELETE CASCADE`) — confirm the notification row itself cascades away rather than pointing at a dead project and crashing the link.

---
## 11. Work Log ("Çalışma Defteri")

- [ ] `POST /work-log` with a valid `body` (1–280 chars) and default `kind` → 201, `entry_date` defaults to today.
- [ ] `POST /work-log` with `kind` outside the enum (`baska_proje|toplanti|idari|egitim|diger`) → 400.
- [ ] `body` empty string or > 280 chars → 400.
- [ ] `minutes` = 0, negative, or > 1440 → 400; `null` or omitted → accepted.
- [ ] Multiple entries the same day for the same user → all persist independently (unlike the old single-note-per-day model this replaced).
- [ ] `GET /work-log?days=N` returns only the CALLING user's own entries for the last N days, newest first.
- [ ] `days` = 0, negative, or > 90 → 400; omitted → defaults to 14.
- [ ] `PATCH /work-log/:id` on an entry belonging to the CURRENT user → updates `kind`/`body`/`minutes`; empty body → 400 (`minProperties: 1`).
- [ ] `PATCH /work-log/:id` on an entry belonging to ANOTHER user (guessed/enumerated id) → rejected (query matches `user_id = request.user.id`, so it should silently affect 0 rows / 404 — verify it's not a 500 and definitely not a successful cross-user edit).
- [ ] `DELETE /work-log/:id` on your own entry → 204; on someone else's entry → no-op/404, never deletes another user's row.
- [ ] `GET /work-log/team?date=YYYY-MM-DD` as team_leader → everyone's entries for that date.
- [ ] Same endpoint as non-team_leader → 403.
- [ ] `date` query malformed (not `YYYY-MM-DD`) → 400 (schema pattern check, not a raw Postgres cast error).
- [ ] Omitted `date` → defaults to today.
- [ ] The `/team` page's per-user cards show each person's full list of today's entries (`work_log_today`), not just the single newest one.
- [ ] Data migrated from the old `daily_status` column (pre-migration-026) appears correctly as a single `'diger'`-kind entry with the right historical date, and the dropped columns (`daily_status`, `daily_status_date`) are no longer referenced anywhere live.

---
## 12. Dashboard, Views & Role-Based Access

- [ ] Dashboard groups projects into "Yeni Proje" (creator assigned, designer hasn't started) vs. "Devam Eden Proje" (Tasarım active) correctly as subtasks get checked.
- [ ] Status color coding matches the documented mapping exactly: 🟠 new, 🟣 first demo cycle in flight, 🟢 second demo cycle (post first-approval re-send), 🔵 Özalit, 🩷 Üretimde, 🟡 Satışta — spot-check a project at each transition point, especially the 🟣→🟢 boundary (first vs. second demo cycle) since it depends on `demo_held`/attempt count, not just current stage name.
- [ ] Period widget's `satista / total` ratio and upcoming month-end deadline update correctly as projects cross into `satista`.
- [ ] Monthly timeline correctly buckets projects with no `target_month` (null) — verify they don't crash the view or silently vanish.
- [ ] `HomeRedirect`: logging in as `satis` lands on `/siparis-talebi`, NOT the dashboard; all other roles land on their documented default (`/`, `/my-projects`, `/approvals/demo`).
- [ ] Direct URL navigation to a role-restricted route (e.g. designer typing `/team` in the address bar) → blocked client-side by `RoleGuard` AND the underlying API calls that page would make still 403 server-side (defense in depth — don't rely on the UI guard alone).
- [ ] Sidebar (`AppShell.navGroups()`) never renders an item whose `roles` allow-list excludes the current user, even momentarily during a role switch (impersonation/logout-login as a different role in the same browser).
- [ ] `AllProjects` for a designer shows only their assigned projects; team_leader/printer see everything (verify actual filter, not just default landing page).
- [ ] Kanban board reflects the same stage set correctly for both TR and ÇİN projects side by side without mixing pipeline-specific stages into the wrong lane.
- [ ] Baskı Listesi (print queue) reflects only stages relevant to active printing work.

---
## 13. Security & Robustness (cross-cutting)

- [ ] Every mutating endpoint (`POST`/`PATCH`/`PUT`/`DELETE`) requires authentication — spot-check each route file for a stray handler missing `attachUser`/`requireRole`.
- [ ] Every route with `additionalProperties: false` truly rejects unknown body keys (regression-test a couple, since this is the main typo/tamper guard across the schema layer).
- [ ] SQL parameters are always passed positionally (`$1`, `$2`, …) — spot check any hand-built query string for interpolated user input (SQL injection surface), especially in filters like `GET /projects?stage=...`.
- [ ] CORS is locked to the production domain in prod config (per the still-open Production Checklist item) — verify current behavior in whatever environment is under test and flag if still wide-open.
- [ ] Rate limits reset correctly after their window and don't accidentally share buckets across unrelated endpoints (e.g. login attempts shouldn't burn the forgot-password bucket).
- [ ] Session cookie flags: `httpOnly` always; `secure` and `sameSite=strict` specifically in production config — verify in the deployed environment, not just localhost.
- [ ] Large/garbage `Content-Type` or malformed multipart body on the avatar upload route → clean 400, not a 500/hang.
- [ ] Concurrent double-submit of the same action (e.g. clicking "Approve" twice fast) doesn't double-advance a stage, double-create an order, or double-send a notification. Confirmed safe by design: `orders` uses an explicit `expectedVersion` check against `order_requests.version`; `projects` advance/approve/reject and `handovers` confirm don't take a client-sent version but instead take a `SELECT ... FOR UPDATE` row lock inside the transaction and re-validate the current `stage`/`status` before applying, so a second concurrent click reads the already-advanced row and 400s instead of double-applying. `handovers` additionally has a unique partial index blocking a second pending handover per project. No code gap here — re-verify after any future refactor of `project-repository.js`'s locking.
- [ ] Deactivated user's *existing* session cookie (obtained before deactivation) is rejected on the very next request — verify `attachUser`'s `is_active` check runs on every call, not just at login.
- [ ] `.env` / secrets never leak in any error response body, even on a 500 (stack traces should not reach the client in production mode).

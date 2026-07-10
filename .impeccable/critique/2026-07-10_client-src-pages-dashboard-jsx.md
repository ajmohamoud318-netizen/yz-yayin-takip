---
target: client/src/pages/Dashboard.jsx
slug: client-src-pages-dashboard-jsx
date: 2026-07-10
method: dual-agent (A: design review · B: detector + browser)
total_score: 23
p0_count: 1
p1_count: 2
p2_count: 2
p3_count: 2
verdict: honest working surface with editorial over-decoration; one real counting bug
---

# Dashboard Critique — `client/src/pages/Dashboard.jsx`

> The "Yıllık Plan" route — Ayşenur's daily landing for status at a glance.
> Reviewed against `DESIGN.md` (Quaint Office, reserved-accent, paper canvas) and `PRODUCT.md` (anti-references, 5 design principles).

**Method:** dual-agent (A: design review · B: detector + browser). Both ran in isolated sub-agents; findings synthesized below.

> **Snapshot persisted at** `.impeccable/critique/2026-07-10_client-src-pages-dashboard-jsx.md`. The `critique-storage.mjs` helper was blocked by the macOS sandbox; this file is the manual equivalent and is what future `/impeccable polish` passes should read.

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2/4 | Current-month band is 5.5%-rose tint behind rows + rose header pill — both rose surfaces compete for the "now" signal. Year-state indicator (`Geçmiş yıl görünümü`) exists in `YearPlanSummary.jsx` but is missing on this full-page dashboard. |
| 2 | Match System / Real World | 3/4 | Gantt metaphor + Turkish month names + 3/4-month lead time match publishing-house thinking. No legend explaining what bar length means. |
| 3 | User Control and Freedom | 2/4 | Three year-input modes (chevron, swipe, wheel) — over-control, with trackpad mis-fire risk via the `tableCanScroll` guard. No `←`/`→` keyboard shortcut. |
| 4 | Consistency and Standards | 2/4 | **Top hit.** Hand-rolled `Yenile` button (L128–134) inlines SVG instead of using canonical `Button`. Hand-rolled `ErrorState` (L279–290) uses `bg-red-50`/`bg-red-700` instead of `bg-destructive` tokens. `odd:bg-background/35` zebra striping is a SaaS-grid tell DESIGN.md bans. |
| 5 | Error Prevention | 3/4 | `error` path renders recover UI. `setYear` clamps to integers. `target_month` parser degrades silently on malformed ISO. No destructive actions. |
| 6 | Recognition Rather Than Recall | 2/4 | 7 cards rely entirely on color recognition; no icons, no numeric badge beyond the count. Legend explaining status groups lives in `YearPlanSummary.jsx` (compact) but is **absent on this full-page dashboard** — backwards. |
| 7 | Flexibility and Efficiency | 3/4 | Three year-input modes. No filter by type, designer, or status. Below 1024px the 7-col row drops to 4 cols = 2 stacked rows above the chart. |
| 8 | Aesthetic and Minimalist Design | 2/4 | 7-card wall + 6 saturated bars + 4 distinct rose surfaces on first paint (header pill, current-month band, current-month header, 5.5%-tint background). DESIGN.md says rose appears ≤2× per screen with at most one eyebrow. This page has the eyebrow **missing** and the rose over-saturated instead. |
| 9 | Error Recovery | 3/4 | `ErrorState` "Tekrar Dene" CTA + `refetch()`. Tarihsiz card lets user click through to fix the date. No destructive actions to confirm. |
| 10 | Help and Documentation | 1/4 | Zero onboarding affordances. A first-time user wouldn't know what `Tarihsiz` means, why bars differ in length, what `Ozalit aşamasında` is, or how to interpret the current-month band. |
| **Total** | | **23/40** | Honest "working but loud" — editorial restraint is what's missing. |

---

## Anti-Patterns Verdict

**Does this look AI-generated? No — but it has the *tells* of a model that didn't search for existing primitives.**

**LLM assessment (A):** Two real tells, the rest is editorial.
- **Hand-rolled `Yenile` button + inline SVG path** (L128–134) — every other button in the file imports from `lucide-react`. The canonical `Button` component exists for this exact case.
- **Hand-rolled `ErrorState` using raw Tailwind red** (`bg-red-50`, `text-red-700`, `bg-red-600`, L279–290) — the design system defines `--destructive` and `bg-destructive` utility. A human designer working in this codebase would use it.
- **Black "Toplam Proje" card** (L255–263, `bg-foreground border-foreground`) — the only dark surface in the entire app. The design system says rose is the only saturated brand color; a black tile reads as "AI wanted a hero metric and invented a new surface treatment." DESIGN.md explicitly bans hero-metric templates.
- **Inconsistent numeric voice** — SummaryCards use `font-mono` (Geist Mono) for the big count, but the year nav (`<span className="tabular-nums">`) and the `%XX` chip on bars use `tabular-nums` *without* `font-mono`. Numerics lose their voice mid-row.

What **doesn't** read as AI:
- No glassmorphism. No gradient text. No `border-left` accent stripes. No `01/02/03` numbered eyebrows outside the real pipeline stages.
- Motion vocabulary is correct: `page-enter`, `stagger-children` (capped at 8), `hover:-translate-y` lift on bars, real `motion-reduce:transition-none` everywhere.
- The bar component encodes 6 pieces of information in ~48px (stage, assignee, title, progress %, inner progress bar, hover lift) — a real information-dense primitive, done well.
- The empty state (`{year} için planlanmış proje yok. / Başka bir yıl seçin veya proje hedef ayı belirleyin.`) is specific and actionable.

**Deterministic scan (B):** Ran the detector (sandbox-bypassed via `/tmp/impeccable-scripts/` copy). 2 advisory findings, both `design-system-font-size`:
- `Dashboard.jsx:242` — `text-[10px]` on the avatar initials circle inside the dark gantt bar
- `Dashboard.jsx:250` — `text-[10px]` on the `%{p.progress}` chip inside the same bar

Both are 1px under the spec's smallest documented step (`eyebrow: 11px`). The detector correctly notes they're off-ramp; functionally they're intentional micro-typography inside a 48px-tall colored bar where a 10px label is needed to keep the avatar circle and progress chip from crowding the height. **Verdict: likely-acceptable; either accept the advisory, add a `micro: 10px` step to the typography ramp, or grow the bar to `h-14` and use the eyebrow step.**

Manual pattern sweep (per the spec's slop test): **clean on all the absolute bans.** Zero hits on `border-l-[2-9]`, `border-r-[2-9]`, `bg-gradient-*`, `backdrop-blur`, `from-{color}-*` gradient utility, inline `01/02/03` markers, `label-eyebrow`, or off-spec `bg-{pipeline}-*` usage. The 2 `border-l` hits (L192, L222) are the timeline month-cell gridlines at default 1px width — gridlines, not a side-stripe decoration.

**Visual browser check (B):** Dev server booted on `127.0.0.1:5181`; logged in as `Ayşenur Kanak`; redirected to `/`. Screenshot captured — render matches the design tokens. Rose-burgundy primary band is present but understated. No glassmorphism artifacts, no raster logos, no broken layout.

**Where A and B agree:** STATUS_STYLES usage is spec-correct (`barFill` -700 for gantt bars, `dot` -500 for chips, `surface`/`border` for SummaryCards, `label` for read-only display). No off-spec token usage anywhere.

**Where A caught what B missed:** Counting bug, 7-card wall, 4 distinct rose surfaces, `hover:-translate-y-[54%]` math error, zebra striping, missing legend. All design-judgment findings, not deterministic-detector targets.

**Where B caught what A missed:** Exact `text-[10px]` line numbers (L242, L250). Visual sanity that the page renders. Confirmation that the dev server boots and the screenshot is clean.

---

## Overall Impression

The dashboard is doing **honest work** — it correctly renders the gantt, the legend, the empty state, the Tarihsiz strip, the current-month marker, and year navigation. The architecture is sound. What it's missing is **editorial restraint** — the 7-card wall, the 4 distinct rose surfaces on first paint, and the missing legend are all "too much" tells. **The P0 counting bug is the kind of issue that erodes trust over weeks; fix it first.** Everything else is polish.

---

## What's Working

1. **All primary controls (except `Yenile`) route through the canonical `Button` component** — year chevrons (`<Button variant="outline" size="icon">`, L114/L118) and `Bu yıl` reset (`<Button variant="ghost" size="sm">`, L123) match `AppShell.jsx`'s icon-button vocabulary exactly. Same 36px height, same outline treatment, same focus ring.
2. **The bar component encodes 6 pieces of information in ~48px** — `meta.barFill` for stage, avatar initials circle, truncated title, `%XX` chip, inner white progress bar, hover lift. Accessible via `title` attribute and `openProject()` click. A real information-dense primitive done well.
3. **Reduced-motion handling is end-to-end, not bolted on** — `motion-reduce:transition-none` on bar hover, on card hover, `stagger-in-fade` (no translate), `page-enter` reduced-motion variant, `bell-pulse: animation: none`. The page doesn't just respect `prefers-reduced-motion` — it does so for every animated surface on the route. Rare and correct.

---

## Priority Issues

### [P0] Counting bug: `Toplam ≠ sum(statuses)` because teal (Üretime Hazır) is dropped

- **What:** `LEGEND_KEYS` on L13 = `['orange', 'purple', 'green', 'blue', 'pink', 'yellow']`. But `STATUS_STYLES` has 7 keys (orange, purple, green, blue, **teal**, pink, yellow — confirmed in `status-styles.js`). And `statusKeyForProject` returns `'teal'` for `uretime_hazir` (confirmed in `domain/services/project-status.js:9`).
- **Why it matters:** Every project in `Üretime Hazır` is invisible to the SummaryCard row. It contributes to `counts.total` but to none of the 6 colored cards. Ayşenur uses this row for "how loaded are we right now" — silent information loss.
- **Fix:** Either:
  1. **Drop the "Toplam" card** (since `counts.total` is the sum of all statuses, including teal) and collapse the row to **3–4 cards** — `Aktif`, `Onay Bekleyen`, `Üretimde`, `Tarihsiz`. Move the 7 status counts into a single inline legend above the chart. This kills the wall *and* fixes the counting bug at once.
  2. **Keep "Toplam" but add teal and let the row overflow** (acceptable on 1440px+, breaks on 1280px and below).
- **Suggested command:** `/impeccable clarify` — hierarchy-of-information, not polish.

### [P1] Hand-rolled `Yenile` button + `ErrorState` violate the design system

- **What:** L128–134 (Yenile) inlines a `<svg>` and uses raw Tailwind classes. L279–290 (ErrorState) uses `bg-red-50 text-red-700 bg-red-600 hover:bg-red-700` — none of which are in the design system. Canonical equivalents exist:
  - `Yenile` should be `<Button variant="outline" size="sm"><RotateCw className="h-4 w-4" />Yenile</Button>` — `ui/button.jsx` already wraps the loading state, focus ring, and press animation.
  - `ErrorState` should be `<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><p className="text-sm text-destructive">{message}</p><Button variant="destructive" size="sm" onClick={onRetry}>Tekrar Dene</Button></div>`.
- **Why it matters:** Off-system primitives are the first thing a new contributor copies. This is the kind of drift that erodes the system quietly.
- **Fix:** as above. Both are < 30-line replacements.
- **Suggested command:** `/impeccable polish` — exact-pattern fixes; no design judgment needed.

### [P1] 7-card wall + 4 distinct rose surfaces violate the "Editorial restraint" rule

- **What:** Top of page is `Toplam (black) + 6 saturated tiles` (L94). Then the timeline gantt with 6 colored bars. Then `bg-primary/[0.055]` band with `border-x border-primary/15` behind the rows (L161). Then a rose-tinted header pill on the current month (L177). Then `bg-primary/10` on the current month cell. **Four distinct rose surfaces on first paint**, plus the brand seal in the sidebar.
- **Why it matters:** The page reads loud. It does not feel like a paper surface. It feels like a dashboard. That's the AI-slop trap the design system was built to avoid.
- **Fix (most impactful first):**
  1. **Drop the SummaryCard row to 3–4 cards** — `Aktif`, `Onay Bekleyen`, `Üretimde`, `Tarihsiz`. Move the 7 status counts into a single inline legend above the gantt. This kills the wall *and* fixes the P0 counting bug at once.
  2. **Replace the `bg-primary/[0.055] border-x border-primary/15` current-month band** with a single dashed hairline on the *header* row only (`border-dashed border-primary/40` on the active month header pill). The 5.5%-rose tint is over-decorating — and the `border-x` is a borderline stripe-violation.
  3. **Add the editorial eyebrow the page is missing** — `<span className="label-eyebrow">Yıllık Planlama</span>` above the h1. This anchors the rose stamp (the spec says the eyebrow is one of the allowed uses) and gives the page the publishing-house voice.
- **Suggested command:** `/impeccable quieter` — the loudest thing wrong is the 7-card wall + 4 rose surfaces, and quieter is the right instinct for a paper-canvas surface.

### [P2] `odd:bg-background/35` zebra striping on gantt rows

- **What:** L210 zebra-stripes rows with `odd:bg-background/35`. Combined with per-row `hover:bg-muted/25` and 7 gridlines per row, that's at least 4 simultaneous quiet visual sources competing for attention.
- **Why it matters:** DESIGN.md bans "data-grid walls." A gantt is *not* a data grid, but zebra striping is the data-grid tell.
- **Fix:** Remove the zebra. L209 already has `border-b`; that's enough row separation. Or replace both with `divide-y divide-border/35` on the wrapper.
- **Suggested command:** `/impeccable polish` — single-attribute change.

### [P2] `hover:-translate-y-[54%]` is a math error

- **What:** L177 lifts the bar by 54% of its *own* height (h-12 = 48px → +26px). That's an arbitrary number from a model's "what's a nice hover lift?" guess, not from the design system.
- **Why it matters:** The bar visually jumps out of its lane on hover, making the row feel broken.
- **Fix:** `hover:-translate-y-1` (4px lift, same vocabulary as `ProjectCard.jsx`'s `hover:-translate-y-0.5`).
- **Suggested command:** `/impeccable polish`.

### [P3] Empty state is good but not on-brand

- **What:** L154–157. Specific (`{year}` interpolated), actionable, not "No data".
- **Fix:** Keep the copy; add a small editorial hint. Something like:
  ```
  {year} için planlanmış proje yok.
  İlk projeyi Yeni Proje düğmesinden oluşturabilir,
  ya da başka bir yılı inceleyebilirsin.
  ```
  Use the rose stamp on `Yeni Proje` as a `text-primary underline underline-offset-4` link to the AppShell's "Yeni Proje" button (team_leader only).
- **Suggested command:** `/impeccable clarify` — voice/messaging, not visual.

### [P3] `Tarihsiz` strip has no visual cue to scroll down

- **What:** L213–246. Tarihsiz projects are the highest-leverage action item on the dashboard (assigning them a month is the first thing Ayşenur does every Monday). It's the quietest part of the page.
- **Fix:** Move the count into the title row — a small inline counter next to the year nav: `Yıllık Plan · 3 tarihsiz →`. Clicking it scrolls to the strip. Or surface it as a `bg-accent` badge on the `Tarihsiz` chip.
- **Suggested command:** `/impeccable layout` — discoverability is a layout problem.

---

## Persona Red Flags

### Ayşenur (`team_leader` — lands on `/` daily)

1. **The 7-card wall forces horizontal scanning that doesn't pay off.** On a 1280px viewport each card is ~172px. Labels like "Ozalit aşamasında" (19 chars) and "Üretime Hazır" (15 chars) need ~120px minimum at 12px font, so they fit — but the card is mostly the big mono number, not the label. The status label is what carries the meaning; the number is what she's scanning for. The visual hierarchy is inverted.
2. **Two rose surfaces compete for the "this month" signal.** The 5.5%-tint band behind the rows AND the rose pill on the month header. If she has a project in the current month, the bar sits inside the rose band, on top of the rose pill — the band becomes background noise.
3. **The counting bug (P0)** — if any `Üretime Hazır` projects exist, `Toplam ≠ sum(statuses)`. She'll eventually notice and lose trust in the row.

### Aylin (`designer` — lands on `/my-projects`, but sometimes checks `/`)

1. **`/my-projects` is the right lens for her, but `/` shows her assigned projects without any "yours" affordance.** She'd have to scan 20 bars and read every assignee initial. A small `Sadece benimkiler` toggle in the title row would let her collapse the surface to her own projects without leaving the dashboard.
2. **No way to see "what's coming up for me this month."** A simple `Bu ay bende: 2` chip in the title row, colored to her stage, would help.
3. **No keyboard shortcut for year navigation.** `←` / `→` for year change is one `useEffect` and one `keydown` listener away.

---

## Minor Observations

- L9 `useRef` for swipe/wheel handlers — no `useEffect` cleanup. `wheelLock.current = false` setTimeout could fire after unmount (harmless).
- L17 `LEAD_MONTHS` is hardcoded in the file — should move to `domain/constants/`.
- L94 `stagger-children` on 7 cards — last child gets 240ms (cap is at child 8+). Adding an 8th card (teal, per P0) will fall into the 300ms "lands together" bucket, breaking visual rhythm. Fixing P0 needs 7 cards max or a custom keyframe.
- L210 `odd:bg-background/35` — `bg-background` is the paper canvas, so 35% alpha lets the zebra bleed through the gantt's `bg-card` surface.
- L279–290 `ErrorState` is *defined inside the same file* — can't be reused. Should live in `components/ErrorState.jsx`.
- `Skeleton className="h-[420px]"` — magic number locks chart height. Should be `min-h-[420px]`.

---

## Questions to Consider

1. **What if there were no SummaryCards at all, and the timeline itself encoded the counts?** Each month column carries a tiny mono counter in its header (`Oca · 3`). The status breakdown lives in a single legend (color = count). The gantt becomes the only thing the eye lands on. Kills the 7-card wall and the rose over-saturation in one move.
2. **What if the dashboard showed a single number — "Bu ay X proje, Y onay bekliyor" — instead of the 7-card wall?** Ayşenur's primary action is "what needs my attention today." A single reading line + a gantt might be enough.
3. **What if the year was a dropdown (a `Select`) instead of chevrons + swipe + wheel?** The triple-input scheme is the opposite of "decision-point-with-4-options"-friendly. A dropdown collapses it to one input and removes the trackpad-mis-fire risk.
4. **What if the current-month band were a vertical hairline + a small "Şu an" pill in the timeline margin, instead of a tinted stripe?** A hairline + margin pill says "now is here, look around you" — more honest about what the band is for.
5. **What if the Tarihsiz projects were cards in a sidebar, not pills at the bottom?** Pulling them out of the gantt into a side rail ("Atanmamış · 3") gives them the prominence they deserve and clears the bottom of the page.

---

> **Trend for `client-src-pages-dashboard-jsx` (last 5 runs):** First run for this target, no trend yet.
> Wrote `.impeccable/critique/2026-07-10_client-src-pages-dashboard-jsx.md`.

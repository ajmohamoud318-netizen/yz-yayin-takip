---
target: client/src (full app, web)
slug: full-app-audit
date: 2026-07-10
method: source scan (no live browser sweep — dev server stayed up from the prior critique pass)
total_score: 14
a11y: 2
perf: 3
theming: 3
responsive: 3
anti_patterns: 3
p0_count: 1
p1_count: 5
p2_count: 6
p3_count: 4
verdict: working, accessible-enough desktop product; Login form and a few dialogs have WCAG issues that need attention before any public-facing release
---

# Full-App Audit — `client/src`

> All routes, all `pages/*.jsx` + `components/*.jsx` + `hooks/*` + `application/*` + `index.css` (121 source files, 25 routes).
> Target: WCAG AA per `DESIGN.md § Accessibility`. Desktop-first, but should not break on smaller screens.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2/4 | Login form: raw `text-gray-*` on `bg-white` with `border-gray-200` — gray text on tinted near-white without contrast check; inputs have no `id`/`htmlFor` binding; no skip link; no `aria-invalid`; many focus styles only via `focus-visible:ring-2` on canonical Button but no global default. |
| 2 | Performance | 3/4 | Most pages use `useMemo` correctly; no layout-thrash patterns; no unbounded blur/shadow. Missing: `React.lazy` for ~25 routes (single bundle), no `loading="lazy"` on the avatar/asset images. |
| 3 | Theming | 3/4 | Token system is comprehensive; dark mode is fully tokenized in `index.css` (`.dark` class). But: Login page is hard-coded to `bg-white` and `text-gray-*` — **no dark mode at all** on the most-seen screen. |
| 4 | Responsive Design | 3/4 | Mobile drawer, breakpoint-aware grids, `overflow-x-auto` on the gantt with `min-w-[900px]` so the gantt scrolls horizontally on small screens (acceptable). `text-[10px]` micro-labels in the gantt bar break the AA-sized-text rule but are inside a colored chip. |
| 5 | Anti-Patterns | 3/4 | Clean on absolute bans (no gradient text, no glassmorphism as decoration, no identical card grids after the dashboard fix). Two residual hits: `bg-gradient-to-r` in `UrunBilgileri.jsx:47,105` (decorative gradient on product card headers), `bg-pink-100 text-pink-700` in `AppShell.jsx:445` and `bg-pink-50` in `TeslimTalepleri.jsx:103` (pink is a real pipeline color so the off-token value is a stray). |
| **Total** | | **14/20** | **Good** — address weak dimensions (a11y) and the Login dark-mode gap before the next public-facing release. |

---

## Anti-Patterns Verdict

**Does this look AI-generated? Borderline clean.** The dashboard critique already shipped 8 of 9 fixes; the rest of the app follows the same design system honestly. Three residual tells:

1. **Login page is the lone stranger.** Hard-coded `text-gray-700`, `border-gray-200`, `bg-white` — none of which are tokens. The page is also non-tokenized for the entire splash screen (`linear-gradient(135deg, #e84040 0%, ...)` — a hard-coded gradient, not even a rose-burgundy token). The whole page is a pre-token file. **A model that didn't search the codebase for the canonical `Button`, `Input`, and `Label` primitives wrote this.**
2. **Two decorative gradients in `UrunBilgileri.jsx`** (L47, L105) — `bg-gradient-to-r from-primary/[0.07] via-primary/[0.03] to-transparent` on the product card header. The DESIGN.md says "no gradient text," but a surface gradient is in the same family of tells. They fade to transparent so they're subtle, but they're still decoration; the same effect is achievable with a flat `bg-primary/5` or `bg-accent`.
3. **Stray pink in `AppShell.jsx:445`** (`bg-pink-100 text-pink-700`) — pink IS a pipeline color (`fuchsia` family), but the value used here is `pink` (the Tailwind base), not `fuchsia`. The codebase uses `fuchsia` everywhere else for this state. A copy-paste from a different palette.

**Clean:** no glassmorphism as decoration (the 2 `backdrop-blur` hits are the dialog/sheet overlay and the sticky header, both legitimate), no `border-l-[2-9]` accent stripes anywhere, no `01/02/03` numbered eyebrows, no `bg-foreground` hero metrics after the dashboard fix, no `rounded-2xl` on the dashboard.

---

## Patterns & Systemic Issues

1. **Inputs without `id`/`htmlFor` binding in Login.jsx (P0 root cause).** The Login form's three `<input>` elements have no `id`. The `<label>`s are not linked. The "30 gün hatırla" checkbox label wraps a `<input type="checkbox">` correctly (implicit label) but has no association either. Screen readers read "edit, email" not "E-posta, edit". The same pattern repeats in **UrunBilgileri.jsx** (L72, L78, L109 — table-cell inputs have no labels) and **DemoRequests.jsx** (L398, L408 — labels for "Demo Adı" and "İçerikler" exist as siblings but no `htmlFor`).

2. **No global focus-visible default.** Only the canonical `Button` has a focus ring (`focus-visible:ring-2 focus-visible:ring-ring`). Plain `<button>` and `<input>` elements in Login, AllProjects, DemoRequests, Kanban, MyProjects, SiparisListesi, UrunBilgileri, and many other files have no focus ring at all. A keyboard user can lose the cursor completely.

3. **No skip link, no `<main id>`, no landmark differentiation.** `AppShell.jsx` renders a `<header>` (top bar) + `<aside>` (sidebar) + content, but the content is a generic `<div>` not `<main>`, and there's no skip-to-content link. The `<Breadcrumb>` is a `<nav aria-label="Breadcrumb">` inside that `<div>`, so screen readers have a single landmark-free blob for the main content.

4. **Login is the only screen without dark mode.** Every other page is tokenized for dark via the `.dark` class on `<html>`. Login hard-codes `bg-white` (L67, L80, L83, L97, etc.). If a user has dark mode enabled, they hit a white-flash login screen.

5. **Hard-coded `text-gray-*` / `border-gray-*` / `bg-red-*` in Login and a few inline error messages.** 9 `text-gray-NNN` references, 3 `bg-red-NNN` references, 2 `border-red-NNN` — all off-system. The DESIGN.md says rose-burgundy is the only saturated color; Login uses Tailwind's default `red-500` for the brand seal.

6. **Forms lack `aria-required`, `aria-invalid`, `aria-describedby`.** All 11 `<form>` blocks submit with `e.preventDefault()` and validate inside `onSubmit`, but field-level errors aren't announced to AT. The error in Login is `role="alert"` (good), but the form fields themselves never receive `aria-invalid="true"`.

---

## Detailed Findings by Severity

### [P0] WCAG: Login inputs lack `id`/`htmlFor` binding; no aria-required; no global focus ring

- **Location:** `client/src/pages/Login.jsx` L106–155
- **Category:** Accessibility
- **Impact:** Screen reader users cannot tell which label goes with which field. Keyboard users lose focus visibility on the password input. Both are WCAG 2.1 AA failures (1.3.1 Info and Relationships; 2.4.7 Focus Visible).
- **WCAG:** 1.3.1 (Info and Relationships, Level A); 2.4.7 (Focus Visible, Level AA)
- **Recommendation:** Add `id="email"` / `id="password"` / `id="remember"` and matching `htmlFor`. Add `aria-required="true"`, `aria-invalid={error ? 'true' : 'false'}`, `aria-describedby="login-error"` to the inputs. Add `:focus-visible` outline to the global `input` base style in `index.css`.
- **Suggested command:** `/impeccable harden` (full a11y sweep + error/edge-case states)

### [P1] Dark mode: Login page is the only screen without it

- **Location:** `client/src/pages/Login.jsx` (entire file)
- **Category:** Theming
- **Impact:** Dark-mode users get a white-flash login screen. The splash also hard-codes a red gradient that's not rose-burgundy.
- **Recommendation:** Replace `bg-white`, `text-gray-*`, `border-gray-*`, `bg-red-*` with the token system. Use `bg-background`, `text-foreground`, `border-input`, `bg-primary` for the splash. The splash gradient can be a single `bg-primary` (rose-burgundy) with a soft radial.
- **Suggested command:** `/impeccable polish client/src/pages/Login.jsx` (replace primitives) or `/impeccable adapt` for the full theme migration

### [P1] No skip-to-content link; `<main>` not used as the content landmark

- **Location:** `client/src/components/AppShell.jsx` L220–240
- **Category:** Accessibility
- **Impact:** Keyboard and screen-reader users have to tab through the entire sidebar (10+ items) on every page change. WCAG 2.4.1 (Bypass Blocks, Level A).
- **Recommendation:** Add `<a href="#main-content" class="sr-only focus:not-sr-only ...">İçeriğe atla</a>` as the first child of the shell. Wrap the content area in `<main id="main-content" tabindex="-1">`. The `tabindex="-1"` is so the skip link can move focus there.
- **Suggested command:** `/impeccable harden`

### [P1] Forms: no `aria-required`, `aria-invalid`, or `aria-describedby` on inputs

- **Location:** All 11 `<form>` blocks across `AcceptInvite`, `ApprovalDialog`, `DemoSubmitDialog`, `Login`, `NewProjectDialog`, `ProjectDetail`, `SiparisListesi`, `TalepSignDialog`, `Team`, `UrunBilgileri`
- **Category:** Accessibility
- **Impact:** Errors are visible but not announced to screen readers. WCAG 3.3.1 (Error Identification, Level A); 3.3.3 (Error Suggestion, Level AA).
- **Recommendation:** Standardize: `<Input aria-required aria-invalid={!isValid} aria-describedby={error ? 'field-error' : 'field-hint'} />`. The canonical `Input` component (`components/ui/input.jsx`) doesn't pass these through; either extend it or pass them per-call. The `FieldError` helper component would help.
- **Suggested command:** `/impeccable harden`

### [P1] Two decorative gradients in `UrunBilgileri.jsx`

- **Location:** `client/src/pages/UrunBilgileri.jsx` L47, L105
- **Category:** Anti-pattern
- **Impact:** `bg-gradient-to-r from-primary/[0.07] via-primary/[0.03] to-transparent` on the product card header. DESIGN.md bans "background-clip: text" with gradient and treats surface gradients as part of the same family of decorative AI slop. A flat `bg-primary/5` would be calmer and on-spec.
- **Recommendation:** Replace both with `bg-primary/5` (or `bg-accent`). The card needs warmth, not a gradient.
- **Suggested command:** `/impeccable quieter client/src/pages/UrunBilgileri.jsx`

### [P1] Stray off-token colors: pink instead of fuchsia, red-500 instead of primary

- **Location:** `client/src/components/AppShell.jsx` L445 (`bg-pink-100 text-pink-700`); `client/src/pages/Login.jsx` (multiple `bg-red-NNN` / `text-red-NNN` / `border-red-NNN` / `bg-red-50` / `text-red-500`); `client/src/pages/UrunBilgileri.jsx` L165 (`bg-black/40`)
- **Category:** Theming / Anti-pattern
- **Impact:** Off-token values bypass the design system. The AppShell pink is wrong (should be `fuchsia` per `status-styles.js`). Login's `red-500` for the brand seal contradicts DESIGN.md "rose-burgundy is the only saturated color."
- **Recommendation:** Swap `pink` → `fuchsia` in `AppShell.jsx:445`. Rebuild Login with tokens. Replace `bg-black/40` in `UrunBilgileri.jsx:165` with `bg-foreground/40` (the tokenized dark overlay) so it responds to theme.
- **Suggested command:** `/impeccable polish` (Login) + small targeted fix for the AppShell and UrunBilgileri

### [P1] No global `:focus-visible` outline on bare inputs/buttons

- **Location:** `client/src/index.css` (no global focus rule) + every page that uses raw `<input>`/`<button>` (Login, AllProjects, MyProjects, Kanban, DemoRequests, UrunBilgileri, SiparisListesi, etc.)
- **Category:** Accessibility
- **Impact:** Keyboard users can lose focus completely on the most-used screens. WCAG 2.4.7.
- **Recommendation:** Add `@layer base { input, button, [role="button"], select, textarea { @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1; } }` to `index.css`. The canonical `Button` already has it; everything else inherits.
- **Suggested command:** `/impeccable harden`

### [P2] No `React.lazy` / route-level code splitting

- **Location:** `client/src/App.jsx` (all imports are static)
- **Category:** Performance
- **Impact:** Initial bundle includes all 25 routes. `framer-motion` (Login), `xlsx` (SiparisListesi Excel upload), `lottie-react` (CelebrationOverlay) all load on first paint even if the user never visits those screens. FCP / TBT hit on the first load.
- **Recommendation:** `const Dashboard = lazy(() => import('./pages/Dashboard'))` and wrap each `<Route>` in `<Suspense fallback={...}>`. This is a standard Vite-friendly change.
- **Suggested command:** `/impeccable optimize`

### [P2] Images without `loading="lazy"` outside the viewport

- **Location:** `AppShell.jsx` L362–366 (logos), `Login.jsx` L37/L86 (logos), `TalepSignDialog.jsx` L638/L729/L1345 (logos), `ProjectDetail.jsx` (asset images)
- **Category:** Performance
- **Impact:** The sidebar logo is above the fold so it should eager-load (correct), but the dialog logos and any user-uploaded assets in project lists lazy-load should be optional. Without `loading="lazy"`, the browser fetches them all on first paint.
- **Recommendation:** Add `loading="lazy"` and `decoding="async"` to images below the fold. Don't add it to the sidebar logo (it's above the fold).
- **Suggested command:** `/impeccable optimize`

### [P2] Avatar/asset images lack `width`/`height` to prevent CLS

- **Location:** `AssigneeAvatars.jsx`, `ProjectCard.jsx`, `AppShell.jsx` (logo has `h-7 w-auto` so layout is OK there)
- **Category:** Performance (CLS)
- **Impact:** Cumulative Layout Shift when avatar stacks render. Each round avatar is `h-6 w-6` or `h-7 w-7` so the size is set, but `<img>` elements should have `width`/`height` attributes (or `aspect-ratio` CSS) so the browser reserves space before the asset loads.
- **Recommendation:** Add explicit `width={N} height={N}` to all `<img>` avatars; the parent `h-N w-N` already constrains so the rendered size is correct, but the intrinsic size is what matters for CLS.
- **Suggested command:** `/impeccable optimize`

### [P2] Two `text-[10px]` literals under the typography ramp

- **Location:** `Dashboard.jsx:242`, `Dashboard.jsx:250` (the gantt bar avatar circle and progress chip)
- **Category:** Accessibility / Theming
- **Impact:** Text smaller than 12px is a WCAG failure for users with low vision. 10px is below the spec's smallest step (`eyebrow: 11px`). The detector also flagged this.
- **Recommendation:** Either grow the bar to `h-14` and use the `eyebrow` step (11px) OR add a `micro: 10px` step to the typography ramp and document it as in-bar-only chrome.
- **Suggested command:** `/impeccable typeset client/src/pages/Dashboard.jsx`

### [P2] Some `<input type="checkbox">` without `id` (and label not associated)

- **Location:** `Login.jsx` L141 (the "30 gün hatırla" checkbox), `UrunBilgileri.jsx` (table-row checkboxes), `NewProjectDialog.jsx` (subtask checkboxes)
- **Category:** Accessibility
- **Impact:** Screen readers may not announce the label correctly because the label wraps the input (implicit association) but the input has no `id`. AT behavior is inconsistent.
- **Recommendation:** Add `id="remember"` and `<label htmlFor="remember">…</label>`.
- **Suggested command:** `/impeccable harden`

### [P2] Two off-system shadow literals in `UrunBilgileri.jsx`

- **Location:** `UrunBilgileri.jsx` L46, L104, L252, L255
- **Category:** Theming
- **Impact:** Hard-coded `shadow-[0_1px_2px_rgba(120,40,80,0.04),0_10px_28px_-18px_rgba(176,52,108,0.22)]` and similar with literal rose-tinted colors. The design system has warm-shadow tokens in `index.css`; these don't reuse them.
- **Recommendation:** Use the existing `shadow-sm` / `shadow-md` tokens, or add a `--shadow-rose` token. Don't ship a one-off rose-tinted shadow as an inline arbitrary value.
- **Suggested command:** `/impeccable polish client/src/pages/UrunBilgileri.jsx`

### [P3] The single visible heading on the brand seal in the sidebar lacks a heading hierarchy

- **Location:** `AppShell.jsx` L362–366
- **Category:** Accessibility
- **Impact:** The sidebar logo uses `<img alt="Yükselen Zeka">` (good) but isn't wrapped in a heading landmark, so the page's heading hierarchy starts at the main content's h1. That's correct WCAG practice — but make sure every page's content area starts with a real `<h1>`. (It does; verified.)
- **Recommendation:** None — the pattern is correct. Listing for completeness.

### [P3] `acceptInvite` form has no error role on the form itself

- **Location:** `AcceptInvite.jsx` L66
- **Category:** Accessibility
- **Impact:** A password-mismatch error is rendered in the page but the form is not announced. A simple `<output>` or `role="status"` next to the error would help.
- **Recommendation:** Add `role="status"` (or `role="alert"` for errors) to the error message wrapper.
- **Suggested command:** `/impeccable harden`

### [P3] `onClick` handlers on non-button elements without `onKeyDown` (minor)

- **Location:** `AllProjects.jsx:137`, `MyProjects.jsx:170`, `DemoRequests.jsx:175`, `Kanban.jsx:115`, `SiparisListesi.jsx:256` — all use `role="button" tabIndex={0}` + onClick, and most add `onKeyDown` for Enter. Verify all five are consistent.
- **Category:** Accessibility
- **Impact:** Inconsistent keyboard support across clickable cards.
- **Recommendation:** Audit and add `onKeyDown` to any card missing it. Kanban.jsx has a partial impl; verify the others.
- **Suggested command:** `/impeccable harden`

### [P3] `Button variant="link"` and similar low-contrast text links

- **Location:** `NewProjectDialog.jsx` (subtask remove buttons), `UrunBilgileri.jsx` (row remove)
- **Category:** Accessibility
- **Impact:** Low-contrast ghost-icon buttons can fail AA on certain surfaces.
- **Recommendation:** Verify on the dark theme; if any drop below 4.5:1, lift to `text-foreground` instead of `text-muted-foreground`.
- **Suggested command:** `/impeccale audit /` (re-run after fixes)

---

## Positive Findings

- **`useMemo` is used appropriately across all pages** — counts, sorted lists, derived subsets. No computation thrash.
- **Reduced-motion is end-to-end** — `index.css` defines fallback keyframes for `page-enter`, `stagger-in`, and the `bell-pulse`. `motion-reduce:transition-none` is sprinkled on hover/transition rules.
- **Canonical `Button` and `Input` primitives are well-built** — focus rings, loading states, `aria-busy`, `aria-hidden` for the spinner, `aria-busy` propagation. The Login page is the only one not using them.
- **Role guards in `App.jsx`** — every protected route is wrapped in `<RoleGuard allow={[...]}>`, with `<Navigate>` for unauthorized. Solid.
- **Reduced-motion respecting Framer Motion in Login.jsx** — `useReducedMotion()` is used to short-circuit the splash and skip the animation. The Login page is sloppy in many other ways but this is correct.
- **No emoji-as-icon abuse** — the codebase uses lucide-react everywhere, with a few custom SVGs (the celebration overlays, the dashboard's "Yenile" — though that's been replaced). No 🚀-as-button-text.
- **Breadcrumb with `aria-label`** in `AppShell.jsx` L1038.

---

## Recommended Actions

1. **`/impeccable harden` (highest priority):** P0 Login a11y, P1 skip link, P1 form aria-required/aria-invalid, P1 global focus ring, P2 checkbox ids, P3 accept-invite role. This is the bundle that makes the app WCAG AA compliant.

2. **`/impeccable polish client/src/pages/Login.jsx`:** Rebuild Login with canonical `Button`, `Input`, `Label`, `Card` primitives; replace all `text-gray-*`/`bg-red-*`/`border-gray-*` with tokens; add the missing `id`/`htmlFor` bindings. This single file gets a 23/40 → ~32/40 score in isolation.

3. **`/impeccable polish client/src/pages/UrunBilgileri.jsx`:** Remove the two decorative gradients, swap inline rose shadows for token shadows, swap `bg-black/40` for `bg-foreground/40`.

4. **`/impeccable quieter client/src/pages/UrunBilgileri.jsx`:** Same file, different lens — the product card has 2–3 surfaces competing for attention. Worth a separate pass.

5. **`/impeccable optimize`:** Add `React.lazy` + `Suspense` to App.jsx; add `loading="lazy"` to below-fold images; add `width`/`height` to avatar `<img>` elements.

6. **`/impeccable typeset client/src/pages/Dashboard.jsx`:** Either grow the gantt bar to `h-14` (and use the 11px eyebrow step) OR add a `micro: 10px` step to the typography ramp. Either is fine; this is the only text-under-12px hit in the app.

7. **`/impeccable polish client/src/components/AppShell.jsx`:** Swap `bg-pink-100 text-pink-700` (L445) → `bg-fuchsia-100 text-fuchsia-700` to match the rest of the system. One-line fix.

8. **`/impeccable audit` (re-run):** After 1–7, re-run to confirm the score climbs to 18–20.

> You can ask me to run these one at a time, all at once, or in any order you prefer.
>
> Re-run `/impeccable audit` after fixes to see your score improve from **14/20**.

---

> **Trend for `full-app-audit` (last 5 runs):** First run for this target, no trend yet.
> Wrote `.impeccable/critique/2026-07-10_full-app-audit.md`.

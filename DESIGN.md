---
name: YZ Yayın Takip
description: Internal publishing pipeline tracker for Yükselen Zeka — a warm, paper-soft, rose-accented work surface for the team leader, designers, matbaa, and sales.
colors:
  rose-primary: "#a5274d"
  rose-soft: "#fdf2f5"
  paper-canvas: "#faf6ef"
  card-surface: "#fcfaf6"
  sidebar-rail: "#f5efe3"
  warm-ink: "#2b2018"
  warm-muted: "#7a6a58"
  warm-hairline: "#e6dccd"
  warm-hover: "#f0e8da"
  destructive: "#c83737"
  emerald-success: "#047857"
  amber-warning: "#b45309"
  teal-production: "#115e59"
  pipeline-orange: "#ea580c"
  pipeline-purple: "#9333ea"
  pipeline-blue: "#2563eb"
  pipeline-fuchsia: "#c026d3"
  pipeline-amber: "#d97706"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.005em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.12em"
    textTransform: "uppercase"
  eyebrow:
    fontFamily: "Geist, system-ui, 'Segoe UI', sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.12em"
    textTransform: "uppercase"
  numeric:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, monospace"
    fontWeight: 500
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.rose-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#8b1f42"
  button-secondary:
    backgroundColor: "{colors.warm-hover}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
  sidebar:
    backgroundColor: "{colors.sidebar-rail}"
    textColor: "{colors.warm-ink}"
  badge-default:
    backgroundColor: "{colors.rose-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.warm-ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
---

# Design System: YZ Yayın Takip

## 1. Overview

**Creative North Star: "The Quaint Office"**

A small publishing house has its own reception desk: warm paper on the counter, a single burgundy stamp for official things, a felt pen for the day's notes. That is what this product should feel like — a working surface for a close-knit team, not a generic SaaS console. The interface is paper-soft, lit from above, and lightly ruled. It is not decorated; it is organized.

**Personality.** Warm, capable, organized. Slightly feminine in palette (rose) but never precious. Every screen reinforces ownership: this is the team's tool, not a vendor's template. The tone is a working office, not a marketing site — buttons commit actions, status pills are the day's marking pen, sidebars are filing rails, and the rose seal appears exactly where work becomes official.

**What this system explicitly rejects.** The product brief in `PRODUCT.md` rules out four anti-references, and they carry straight into this spec: **generic SaaS gray** (Notion/Linear) is forbidden — there is no neutral utility-tool look here, the canvas is warm. **Consumer app casualness** (Instagram/Pinterest) is forbidden — no rounded 28px cards, no pastel confetti, no glassmorphism as decoration. **Heavy enterprise density** (Jira/SAP) is forbidden — no data-grid walls, no multi-toolbars-per-row, no eight-column dense tables. **AI-default warm cream/sand** is forbidden — the canvas is not "cream" generically; it is paper (a low-chroma warm ivory, ~L 0.97, C 0.02, hue 40) used as a quiet foundation, with the rose identity carrying warmth, not the background.

**Key Characteristics:**
- **Paper-first canvas.** Warm ivory paper, slightly raised warm-white card surfaces, warm hairlines — the document metaphor is structural, not decorative.
- **Burgundy as the only seal.** Rose-burgundy (`#a5274d`) is reserved for primary actions, focus rings, and the brand mark. It is a stamp, not a brush.
- **Editorial headings, working body.** Fraunces serif carries the publishing-house character in h1–h3; Geist carries everything the team actually reads and clicks.
- **Status as marking pen, not as decoration.** The six pipeline colors (orange, purple, emerald, blue, teal, fuchsia, amber) appear as small dots, top borders, and soft chip backgrounds — never as page surfaces.
- **Quiet motion.** Motion is feedback only: 200ms ease-out on hover, a 1.4s bell pulse when work is pending, a fade-and-lift on route change. No choreographed entrances, no decorative scroll-driven reveals.

## 2. Colors

A restrained, warm paper palette. A single rose-burgundy is the only saturated brand color; everything else is warm neutral, and the six pipeline colors appear as state indicators, never as decoration.

### Primary
- **Burgundy Stamp** (`#a5274d` / `hsl(345 72% 40%)`): the only saturated color in the system. Used for primary action buttons (Save, Approve, Submit, Onayla), focus rings, the brand seal, and the small editorial eyebrow above section titles. Rare by design — the stamp appears at most 2-3 times per screen.
- **Burgundy Pressed** (`#8b1f42`): hover state for the primary. One step deeper, never lighter, so a pressed stamp is darker.

### Secondary
- *No secondary accent.* The rose IS the accent. Adding a second saturated color would dilute the stamp's authority.

### Tertiary
- *No tertiary.* A six-color pastel set lives in `tailwind.config.js` (`pastel.*`) for kanban and chart fills only — never for buttons, never for type.

### Neutral
- **Paper Canvas** (`#faf6ef` / `hsl(40 30% 98%)`): the body. The base surface of every page. The product brief is specific: not generic cream, not off-white cool; a warm ivory at L 0.97, low chroma, hue 40.
- **Card Surface** (`#fcfaf6` / `hsl(40 50% 99%)`): the slightly-raised panel. One step lighter than the canvas so cards feel lifted, not stamped.
- **Sidebar Rail** (`#f5efe3` / `hsl(42 28% 96%)`): the navigation rail. Slightly warmer and slightly more chroma than the canvas so it reads as a "wall" the canvas is "papered onto."
- **Warm Ink** (`#2b2018` / `hsl(25 12% 16%)`): the only body text color. Deep warm brown-black, not true black. Pair with `Geist` body family.
- **Warm Muted** (`#7a6a58` / `hsl(30 8% 40%)`): secondary text, labels, helper copy. Verified AA on paper canvas.
- **Warm Hairline** (`#e6dccd` / `hsl(36 18% 88%)`): all borders, dividers, input outlines. One step warmer than the muted text so hairlines feel like printed rules, not engineered frames.
- **Warm Hover** (`#f0e8da` / `hsl(40 24% 91%)`): hover state for ghost buttons, list items, and quiet interactive surfaces.

### Semantic (state vocabulary, used sparingly)
- **Destructive** (`#c83737`): the cancel/reject stamp. Only on destructive actions and rejection chips.
- **Emerald Success** (`#047857`): the success state — completed subtasks, confirmed handover, "onaylandı".
- **Amber Warning** (`#b45309`): the wait state — pending approvals, in-progress requests.
- **Teal Production** (`#115e59`): the queue state — "Üretime Hazır", production-ready items waiting on an order.

### Pipeline Colors (status indicators only — never page surfaces)
These six colors carry the entire pipeline vocabulary. They appear exclusively as **status dots**, **3px top borders on cards**, and **soft tinted chip backgrounds** (`*-50` on light, `*-950/50` on dark). They are not buttons; they are not page chrome.

- **Pipeline Orange** (`#ea580c`): Yeni Proje — assigned, not started.
- **Pipeline Purple** (`#9333ea`): Devam Eden — designer is working.
- **Pipeline Blue** (`#2563eb`): Özalit aşamasında — proofs in the queue.
- **Pipeline Fuchsia** (`#c026d3`): Üretimde — at the printer.
- **Pipeline Amber** (`#d97706`): Satışta — finished, with sales.
- **Teal Production** (`#115e59`): Üretime Hazır — approved and queued.
- **Pipeline Emerald** (via success palette): Demo onayı — green confirmation.

### Named Rules

**The Reserved Accent Rule.** Rose-burgundy is the only saturated color permitted on the canvas. It is reserved for: primary action buttons, the focus ring, the brand seal/mark, and at most one editorial eyebrow per screen. It is never used as a background surface, never as a full-width banner, never as a stripe or border. If a component needs warmth, use the warm neutral ramp; if it needs state, use the pipeline colors. Rose is a stamp, not a brush.

**The No-Cream Rule.** The canvas is paper, not cream. A neutral body background at L 0.97 with low chroma is fine; a "warm beige" page tinted toward `oklch(L 0.95, C 0.04, hue 60)` is the AI slop trap we explicitly reject. If the page reads as "warm beige sand", drop the chroma to ≤0.02 and keep the hue near 40, not 70.

**The Pipeline-Color Discipline.** The six pipeline colors appear as small status indicators (dot, top border, soft chip) only. They never fill a card, never appear as a button background, never drive a full-width bar. The dashboard timeline gantt uses the same six colors as `barFill` (the darker `-700` step) so white label text clears AA — but the rule still holds: a status color is a marker, not a surface.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif fallback)
**Body Font:** Geist (with system-ui, 'Segoe UI', sans-serif fallback)
**Label/Mono Font:** Geist Mono (with ui-monospace, SFMono-Regular, monospace fallback)

**Character.** Fraunces is a contemporary editorial serif with optical sizing; the 9..144 opsz axis lets it bloom at display sizes and stay disciplined at small sizes. Paired with Geist (a clean, warm, technical sans), the system reads as "publishing house that ships": the serif says *this matters*, the sans says *this is a tool you use all day*. Geist Mono carries numbers (counters, dates, adet, page counts) — a quiet publishing convention that gives numeric data a stamp of authority.

### Hierarchy
- **Display** (Fraunces 600, 36px, lh 1.15, tracking -0.005em): used once per page — the page title. The serif is the only place the system is loud.
- **Headline** (Fraunces 600, 24px, lh 1.2): section headers, project titles in cards, dialog titles. The serif continues at smaller sizes.
- **Title** (Fraunces 600, 18px, lh 1.3): card titles, list-item headers, sub-section headers. The serif at working size.
- **Body** (Geist 400, 14px, lh 1.5): every paragraph, every description, every helper text. Cap line length at 65–75ch for prose; data and tables can run denser.
- **Label** (Geist 500, 13px, lh 1.4): button text, table headers, form labels, navigation. The working size.
- **Eyebrow** (Geist 600, 11px, tracking 0.12em, uppercase): small editorial eyebrows above display/headline (`.label-eyebrow`). Used once per screen maximum, never above every section.
- **Numeric** (Geist Mono 500): counters, page counts, dates, adet (order quantities). Always for numerals; never for body prose.

### Named Rules

**The Editorial Eyebrow Rule.** Small uppercase tracked eyebrows (`label-eyebrow` class) appear at most **once per screen**, sitting above the page title. They are a brand voice, not a layout pattern. Putting an eyebrow on every card, every section, every modal is the AI grammar trap we explicitly reject — the publishing-house sensibility comes from restraint, not from labeling everything.

**The One-Voice Rule For Type.** Display and headline tiers always use Fraunces; body, label, and buttons always use Geist. The two voices never mix. Headings in a sans font, or body copy in a serif, breaks the document metaphor and the system loses its character.

## 4. Elevation

This system is **tonal, not shadowed.** The base canvas (paper) and the raised card surface (slightly lighter, `hsl(40 50% 99%)`) do all of the depth work; shadows are reserved for elements that need to "lift off" the page — modals, sheets, hover-floated cards, the active sidebar item.

### Shadow Vocabulary
- **Ambient Card** (`0 1px 2px hsl(30 12% 20% / 0.04)`): the resting shadow on `.card`. Almost imperceptible — confirms the card is a panel, not a stamp.
- **Lifted Card** (`0 8px 24px hsl(30 12% 20% / 0.08)`): the shadow when a card is dragged, hovered-as-actionable, or actively selected.
- **Sheet** (`0 24px 48px hsl(30 12% 20% / 0.18)`): the iOS-like drawer shadow on Sheet (right-edge drawer) and Dialog overlays. Wide, soft, expensive.
- **Popover** (`0 4px 12px hsl(30 12% 20% / 0.12)`): dropdowns, popovers, tooltips. Tighter than sheet; the small surface is close to the canvas.

### Named Rules

**The Flat-By-Default Rule.** At rest, surfaces are flat. Tonal layering (paper canvas vs. card surface vs. sidebar rail) does the depth work; shadows only appear on state — hover, active, focus, drag, modal-open. A card on the dashboard has a hairline border and a 1px ambient shadow, nothing more. A "shadowed" card at rest is wrong.

**The Warm-Shadow Rule.** All shadows carry a warm tint (`hsl(30 12% 20%)` base, never pure black). Pure-black shadows are the SaaS-gray tell we explicitly reject; a warm shadow sits on the paper canvas the way ink sits on paper.

## 5. Components

For each component, lead with a short character line, then specify shape, color, and states.

### Buttons
- **Shape:** 8px radius (`rounded-md`).
- **Primary:** rose-burgundy `#a5274d` background, white text, soft 1px ambient shadow. Padding `8px 16px`, height 36px. Hover: `bg-primary/90` (slightly translucent) → resolves to `#8b1f42` after 200ms ease-out. Active: `scale(0.98)` for 100ms — a "stamp press".
- **Secondary:** warm-hover `#f0e8da` background, warm-ink text. Same shape, lighter weight. Used for non-committal actions (Cancel, Back, Vazgeç).
- **Outline:** `border-input` (warm hairline) on `bg-background` (paper), hover `bg-accent`. Used in dialogs and forms.
- **Ghost:** transparent, hover `bg-accent` (warm hover). Used in the sidebar nav, table rows, and destructive action menus.
- **Destructive:** red `#c83737` background, white text. Only on truly destructive actions (reject, delete, cancel order).
- **Success:** emerald `#047857` background, white text. Only on the "Onayla" / "Alındı" confirm.
- **Loading state:** spinner slides in from the left over 200ms, button disables, `aria-busy=true`. Verified against all variants.
- **Sizes:** sm (32px), default (36px), lg (40px), icon (36×36). Never a 56px hero button.

### Chips / Badges
- **Shape:** 6px radius (`rounded-sm`), padding `2px 8px`.
- **Default (rose):** rose-primary bg, white text, subtle shadow. Used for primary status (e.g. "Demo 1", "Yeni").
- **Secondary (neutral):** secondary bg, secondary-foreground. Used for metadata, secondary counts.
- **Pipeline status chips:** the six pipeline colors at `*-50` background, `*-700` text, `*-600/20` ring. Used for stage labels in the dashboard. Soft enough to read as a marking pen, not a sticker.
- **Destructive / Warning / Success:** `*-100` background, `*-700` text. Standard state vocabulary.

### Cards / Containers
- **Corner style:** 10px radius (`rounded-lg`).
- **Background:** card-surface `#fcfaf6` (slightly lighter than canvas).
- **Border:** 1px warm-hairline `#e6dccd`.
- **Shadow:** 1px ambient at rest; 8px lift on hover when interactive.
- **Padding:** 24px (`p-6`) for full cards; 16px for compact summary cards.
- **Status top-border:** 3px top border in the project-status color (orange, purple, blue, etc.) — the project card's stage signal.
- **Internal padding scale:** `p-3` (compact), `p-4` (default), `p-6` (full).

### Inputs / Fields
- **Style:** 8px radius, 1px warm-hairline border, white background, warm-ink text.
- **Focus:** 2px rose ring (`ring-ring`), warm-ink border lifts to rose-primary. `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` pattern.
- **Placeholder:** warm-muted `#7a6a58` — verified AA on white (4.5:1).
- **Error:** destructive border + destructive helper text below.
- **Disabled:** warm-hover bg, warm-muted text, no shadow.

### Navigation (Sidebar)
- **Rail:** sidebar-rail `#f5efe3` background (warmer than canvas), 240px expanded, 64px collapsed (icon-only). Persists collapse state to localStorage.
- **Group labels:** Geist 600, 11px, uppercase, tracking 0.12em, warm-muted — at most 4 group labels (Ana menü, Onaylar, Yönetim, Acil İşler).
- **Nav item:** 36px height, 8px radius, 12px horizontal padding. Default: transparent. Hover: warm-hover bg. Active (current route): white card-surface bg + warm-hairline border (a "lifted rail" affordance, not a left-stripe accent).
- **Pending-state highlight:** rose-soft `#fdf2f5` bg + 1px inset rose ring at 25% opacity. Reserved for items where the user has work waiting (Demo Onayı, Özalit Onayı) — never decoration.
- **Badges:** count badges on the right (e.g. "3"), rose-primary bg, white text, 6px radius.
- **Logo zone:** at the top of the rail — full logo when expanded, monogram when collapsed.

### Dialogs / Sheets
- **Dialog:** centered modal, sheet-shadow, card-surface bg, 12px radius, 24px padding. Backdrop: warm-ink at 50% opacity (not pure black).
- **Sheet (drawer):** right-edge drawer, 480px wide on desktop, full-width on mobile. Slides in with `ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`) over 250ms — iOS-like.
- **Form dialog:** 560px max-width, single column, label-on-top pattern (not floating labels, not inline labels).

### Project Card (signature component)
- **Frame:** card rules above. 3px top border in the project's status color.
- **Header:** Fraunces 600, 18px, project title. Eyebrow: project ID or designer name in Geist 500 11px uppercase muted.
- **Progress:** thin warm-hairline track with rose-primary fill at `progress%`. Numbers in Geist Mono.
- **Stage chip:** pipeline-color chip (orange/purple/blue/etc.) with the Turkish stage label.
- **Assignees:** avatar stack at the bottom-right (24px avatars, 2px white ring between).

### Signature Component: Status Timeline Bar
- **Use:** the dashboard's monthly timeline gantt; the project detail's stage bar.
- **Frame:** 8px radius, 4px height per bar, stage color from the pipeline palette.
- **Label:** white Geist 500 11px inside the bar; warm-ink Geist 500 11px outside when the bar is too narrow.
- **Track:** warm-hairline background, no shadow.

## 6. Do's and Don'ts

Concrete, forceful guardrails. Every anti-reference in `PRODUCT.md` carries through as a "Don't" so the visual spec enforces the strategic line.

### Do:
- **Do** use the rose stamp once or twice per screen — for one primary action and at most one editorial eyebrow. The stamp is rare, and that rarity is the point.
- **Do** keep the canvas paper-warm (`#faf6ef`) and let cards lift by being one step lighter (`#fcfaf6`). Depth is tonal, not shadowed.
- **Do** use Fraunces for h1–h3 and Geist for body/labels/buttons. The two voices never mix.
- **Do** treat pipeline colors as markers (dot, top border, soft chip), not as page chrome. A teal pipeline color is for "Üretime Hazır", not for a section background.
- **Do** use 200ms ease-out for state transitions and 1.4s slow pulse for the unread bell. No choreographed entrances, no bounce, no elastic.
- **Do** verify every text color hits AA (4.5:1 body, 3:1 large) against its actual background. Warm-muted on paper is the riskiest pair — check it.
- **Do** keep the editorial eyebrow (`label-eyebrow`) to **one per screen**. The publishing-house voice comes from restraint.
- **Do** respect `prefers-reduced-motion`. Every animation has a crossfade fallback; the bell pulse, the page-enter, the stagger-children, the sheet slide all collapse to opacity-only.

### Don't:
- **Don't** use border-left or border-right greater than 1px as a colored accent on cards, list items, callouts, or alerts. Never. The active sidebar item uses a 1px ring, not a stripe.
- **Don't** use `background-clip: text` with a gradient. Emphasis comes from weight, size, and the rose stamp — not from rainbow text.
- **Don't** use glassmorphism as decoration. Backdrop-blur is reserved for actual translucency (the bell dropdown at most); never for ambient cards.
- **Don't** reach for hero-metric templates (big number, small label, gradient accent, supporting stats). The dashboard is operational, not promotional.
- **Don't** use identical card grids. Project cards vary by status (top border, chip, progress), summary cards vary by content — a uniform 3×2 icon-card grid is the SaaS-default trap.
- **Don't** use the cream/sand warm-neutral band generically. The canvas is paper (`#faf6ef`, low chroma, hue 40), not "warm beige". A page that reads as sand has drifted.
- **Don't** make the rose a background. Rose-soft `#fdf2f5` is allowed only as a 5% tint for the active sidebar item and the "pending" highlight; never as a section bg, banner, or stripe.
- **Don't** animate CSS layout properties (height, width, top, left) on state changes. Use opacity, transform, and clip-path instead.
- **Don't** pair display fonts that compete. Fraunces + Geist is the only pairing; adding Inter, Manrope, Plus Jakarta, Sora, or any geometric sans is forbidden.
- **Don't** add a "Layout Principles", "Motion", or "Responsive Behavior" section to this spec. The six spec sections are the only six. Fold responsive rules into Components.
- **Don't** use `01 / 02 / 03` numbered section markers as default scaffolding. The pipeline's numbered stages (`Tasarım → Demo → Özalit → Üretim → Satışta`) are real sequence markers, not the eyebrow-on-every-section reflex. Outside the pipeline, no numbered eyebrows.
- **Don't** ship without verifying the dark mode. The dark tokens are warm near-black (`#1c1814` family), not pure black; rose is lifted to `hsl(345 65% 55%)`; muted foreground (`hsl(36 10% 64%)`) hits AA on the dark canvas. Test both.

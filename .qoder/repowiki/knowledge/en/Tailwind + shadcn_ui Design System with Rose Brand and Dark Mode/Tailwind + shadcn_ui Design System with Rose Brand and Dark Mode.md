---
kind: frontend_style
name: Tailwind + shadcn/ui Design System with Rose Brand and Dark Mode
category: frontend_style
scope:
    - '**'
source_files:
    - client/tailwind.config.js
    - client/src/index.css
    - client/components.json
    - client/postcss.config.js
    - client/src/components/ui/button.jsx
    - client/src/components/ui/card.jsx
    - client/src/components/ui/dialog.jsx
    - client/src/components/ui/sheet.jsx
    - client/src/components/ui/input.jsx
    - client/src/components/ui/badge.jsx
---

## What system/approach is used

The client (`client/`) is a Vite + React SPA styled with **Tailwind CSS v3** processed through PostCSS (autoprefixer). The visual layer is built on the **shadcn/ui** component library, configured via `components.json` with the `new-york` style preset, Tailwind CSS variables enabled, and the `slate` base color. Components live in `src/components/ui/` (Button, Card, Dialog, Sheet, Tabs, Tooltip, etc.) and are composed into domain-specific components under `src/components/`. Animation utilities come from the `tailwindcss-animate` plugin.

## Key files and packages

- `client/tailwind.config.js` — theme extensions: brand palette (teal scale), pastel chart colors, font families (Geist, Geist Mono, Fraunces, Utter Butter), border radius tokens, dark mode via `class`, content glob `./src/**/*.{js,jsx}`.
- `client/src/index.css` — single source of truth for design tokens: CSS custom properties for light/dark themes under `:root` and `.dark`, global typography rules, motion curves (`--ease-out`, `--ease-in-out`, `--ease-drawer`), safe-area insets, touch targets, focus rings, page transitions, staggered list animations, notification toasts, print styles.
- `client/components.json` — shadcn/ui configuration pointing at `tailwind.config.js`, `src/index.css`, aliases (`@/components`, `@/components/ui`, `@/lib`, `@/hooks`).
- `client/postcss.config.js` — Tailwind + Autoprefixer pipeline.
- `client/src/components/ui/*.jsx` — shadcn-generated primitives using `class-variance-authority` (cva) variants and `@/lib/utils` `cn()` helper; e.g. Button defines `default/secondary/outline/ghost/link/destructive/success` variants and `sm/lg/icon/default` sizes.
- `client/package.json` — declares dependencies: `tailwindcss`, `postcss`, `autoprefixer`, `tailwindcss-animate`, `@radix-ui/*` primitives, `lucide-react` icons, `sonner` for toasts.

## Architecture and conventions

1. **Design tokens via CSS variables**: All semantic colors (`background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `card`, `popover`, `sidebar`) are defined as HSL values in `index.css` under `:root` (light) and `.dark` (dark). Tailwind maps them via `hsl(var(--token))` so every component inherits theme changes automatically.
2. **Brand identity**: Primary actions use a rose-burgundy (`--primary: 345 72% 40%`) rather than a neutral blue; the ring/focus color matches it. A dedicated `brand` teal scale (50–900) exists for secondary accents (e.g., filled brand circles where white text must clear WCAG AA). A `pastel` palette (lavender, mint, peach, sky, rose, butter, periwinkle) is reserved for charts and kanban.
3. **Typography**: Body uses `Geist` (sans); headings (`h1`–`h3`) use `Fraunces` serif with optical sizing and balanced text-wrap; monospace uses `Geist Mono`; an optional creative role switches all fonts to `Utter Butter` via the `html.font-creative` class. Display fonts are loaded once in `index.html`.
4. **Dark mode**: Activated by adding the `dark` class to the root element (configured as `darkMode: 'class'` in Tailwind). Every token has a paired dark value.
5. **Component styling pattern**: Each UI primitive is a forwardRef component that composes Tailwind classes through `cn(...)` and `cva` variants. No inline styles or SCSS modules are used — everything is utility-first.
6. **Motion language**: Centralized easing curves (`--ease-out`, `--ease-in-out`, `--ease-drawer`) drive consistent enter/exit animations across dialogs, sheets, tooltips, and page transitions. Global keyframes cover page-enter, staggered children, bell pulse, sidebar highlights, worklog rows, and Year Plan bar draws. All animations respect `prefers-reduced-motion` by collapsing to opacity-only fades.
7. **Responsive/mobile**: Touch devices get `touch-action: manipulation` on interactive elements, a 36px minimum tap target (excluding checkboxes/radios/switches), and form controls bumped to 16px font-size to prevent iOS Safari zoom. Safe-area insets (`env(safe-area-inset-*)`) protect notched devices.
8. **Print stylesheet**: A comprehensive `@media print` block hides chrome (toasts, popovers, dialog overlays), resets shadows/animations, sets A4 pages with 12mm margins, and keeps cards whole with `break-inside: avoid`.
9. **Accessibility**: Global `focus-visible` rule applies the rose ring to raw inputs/buttons without custom focus handling; `aria-busy` is set on loading buttons; reduced-motion media queries disable motion for users who prefer it.

## Conventions and constraints

- **Use shadcn/ui primitives** from `@/components/ui/*` instead of writing raw DOM elements with ad-hoc classes — observed in every UI component.
- **Theme colors must be referenced via Tailwind tokens** (`bg-primary`, `text-muted-foreground`, etc.) mapped to CSS variables; hard-coded hex colors are avoided except for the fixed `brand` and `pastel` scales.
- **Dark mode is opt-in via the `.dark` class** on the root; components do not need separate dark variants — they inherit from the variable-based tokens.
- **Animations must use the shared easing variables** (`--ease-out`, `--ease-in-out`, `--ease-drawer`) and include a `prefers-reduced-motion` fallback that disables movement while preserving fade semantics.
- **Touch targets on coarse pointers must be ≥ 36px** (enforced globally for `<button>` and similar elements, excluding Radix checkbox/radio/switch roles whose labels serve as the hit area).
- **Form inputs on touch devices must render at 16px** to avoid iOS Safari's forced zoom behavior; this is enforced globally for non-checkbox/range inputs/select/textarea.
- **Fonts are scoped**: body uses Geist; headings use Fraunces; creative roles switch to Utter Butter via the `html.font-creative` class — no other font overrides are applied in components.
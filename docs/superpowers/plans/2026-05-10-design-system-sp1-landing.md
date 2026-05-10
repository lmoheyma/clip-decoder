# Design System Migration SP1 — Landing Reskin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the ClipDecoder landing page to the new editorial design system (warm-near-black canvas, EB Garamond + Inter, pastel ambient orbs, white pill CTA), while leaving the report page functionally intact (visually wrong but renders).

**Architecture:** Hybrid Tailwind v4 `@theme` tokens + plain CSS component classes from the new design fixture (`styles.css` at repo root). Old tokens and classes coexist with new ones in `globals.css` throughout SP1 so report components keep rendering — they're dropped in SP2.

**Tech Stack:** Next.js 15 (App Router), Tailwind v4, React 19, TypeScript, `next/font/google` (EB Garamond, Inter), Vitest + React Testing Library.

**Spec:** [docs/superpowers/specs/2026-05-10-design-system-migration-sp1-design.md](../specs/2026-05-10-design-system-migration-sp1-design.md)

---

## Notes for the implementer

This is a **visual reskin**, not a logic change. There are no new behaviors to write tests for.

**TDD adaptation for this plan:** Each task includes a "Baseline" check (verify existing tests pass before touching anything) and a "Regression" check (verify the same tests still pass after). The "failing test → implementation → passing test" cycle does not apply because no new behavior is added — the regression suite is the safety net.

**Manual verification** is what catches visual issues. The final task contains a checklist; spot-check earlier tasks in the browser as you go.

**Reference files** at the repo root (untracked, kept as authoring source):
- `index.html` — full design fixture, lines 634–738 cover the landing.
- `styles.css` — full new design system CSS (344 lines).

You will copy CSS verbatim from `styles.css` in several tasks. Do not paraphrase — use the exact rules so the rendering matches the design.

---

## Prerequisites

Before starting Task 1, create the working branch:

```bash
cd /home/louis/clip-decoder
git checkout main
git pull --ff-only
git checkout -b feature/design-system-sp1
```

Verify clean state:

```bash
git status
# Expected: "On branch feature/design-system-sp1" and "nothing to commit, working tree clean"
#           (untracked index.html, styles.css, frontend/.pnpm-store/, etc. are fine)
```

Run the existing test suite once to establish baseline:

```bash
cd frontend && pnpm test --run
```

Expected: all tests pass. If anything fails before you've changed anything, STOP and investigate before proceeding.

---

### Task 1: Swap display + body fonts in the root layout

**Files:**
- Modify: `frontend/app/layout.tsx` (full file — 33 lines)

**Why:** The new design uses EB Garamond 300 for serif display and Inter for everything else. The current setup loads Bricolage Grotesque + IBM Plex Mono, which we drop entirely.

- [ ] **Step 1: Replace `frontend/app/layout.tsx`**

```tsx
import "./globals.css";
import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["300"],
  style: ["normal", "italic"],
  variable: "--font-eb-garamond",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClipDecoder — Every shot is a quotation. We name the source.",
  description:
    "Paste a music video. ClipDecoder splits it into shots, asks a vision model what it sees, then cross-references each frame against a library of films, paintings, photographs, and other clips.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ebGaramond.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green (HeroForm tests will still work because they don't depend on fonts).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat(frontend): swap fonts to EB Garamond 300 + Inter"
```

---

### Task 2: Add new design tokens and replace base body styles in globals.css

**Files:**
- Modify: `frontend/app/globals.css` — keep all existing rules, **prepend** a new tokens block; **replace** the `html, body` rule.

**Why:** The new design needs its CSS variables exposed both as raw CSS vars (for plain CSS classes like `.btn`) and as Tailwind v4 `@theme` tokens (for utilities like `bg-canvas`, `text-ink`). The body becomes the warm-near-black canvas globally.

- [ ] **Step 1: Read current globals.css to confirm structure**

Open `frontend/app/globals.css`. Note that:
- Line 1 is `@import "tailwindcss";`
- Lines 6–24 are the existing `:root` block (`--color-midnight`, `--color-magenta`, etc.)
- Lines 31–38 are the existing `html, body` rule

You will keep all existing rules. You will add new content after the existing `:root` block and replace the `html, body` block.

- [ ] **Step 2: Add new `:root` tokens (additive)**

Open `frontend/app/globals.css` and **after** the existing `:root { ... }` block (around line 24), insert:

```css
/* ─────────────────────────────────────────────────────────────────
   SP1 — New design system tokens (editorial register).
   Coexist with the legacy tokens above until SP2 drops them.
   ───────────────────────────────────────────────────────────────── */
:root {
  /* Surface */
  --canvas:           #0c0a09;
  --canvas-soft:      #14110f;
  --surface-card:     #1c1917;
  --surface-strong:   #292524;
  --surface-dark:     #000000;

  /* Hairlines */
  --hairline:         rgba(255, 255, 255, 0.08);
  --hairline-soft:    rgba(255, 255, 255, 0.05);
  --hairline-strong:  rgba(255, 255, 255, 0.14);

  /* Text */
  --ink:              #f5f5f5;
  --body:             #a8a29e;
  --body-strong:      #e7e5e4;
  --muted:            #777169;
  --muted-soft:       #57534e;
  --on-primary:       #0c0a09;

  /* Pastel orb stops */
  --grad-mint:        #a7e5d3;
  --grad-peach:       #f4c5a8;
  --grad-lavender:    #c8b8e0;
  --grad-sky:         #a8c8e8;
  --grad-rose:        #e8b8c4;

  /* Semantic */
  --success:          #4ade80;
  --error:            #f87171;

  /* Type — no `--mono` token: Inter is used for "mono" elements via uppercase + letter-spacing */
  --sans:  var(--font-inter), system-ui, -apple-system, "Helvetica Neue", sans-serif;
  --serif: var(--font-eb-garamond), "GT Sectra", "Times New Roman", serif;

  /* Radii */
  --r-1:    8px;
  --r-2:    16px;
  --r-3:    24px;
  --r-pill: 9999px;

  /* Shadow */
  --shadow-1: 0 4px 24px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 3: Add Tailwind v4 `@theme` block**

Immediately after the new `:root` block, add:

```css
/* Expose new tokens to Tailwind v4 utility generation. */
@theme {
  --color-canvas:         var(--canvas);
  --color-canvas-soft:    var(--canvas-soft);
  --color-surface-card:   var(--surface-card);
  --color-surface-strong: var(--surface-strong);
  --color-ink:            var(--ink);
  --color-body:           var(--body);
  --color-body-strong:    var(--body-strong);
  --color-muted:          var(--muted);
  --color-muted-soft:     var(--muted-soft);
  --color-grad-mint:      var(--grad-mint);
  --color-grad-peach:     var(--grad-peach);
  --color-grad-lavender:  var(--grad-lavender);
  --color-grad-sky:       var(--grad-sky);
  --color-grad-rose:      var(--grad-rose);
  --color-success:        var(--success);
  --color-error:          var(--error);
  --font-sans:            var(--sans);
  --font-serif:           var(--serif);
  --shadow-1:             var(--shadow-1);
  --radius-1:             8px;
  --radius-2:             16px;
  --radius-3:             24px;
  --radius-pill:          9999px;
}
```

- [ ] **Step 4: Replace the `html, body` rule**

Find the existing rule (around line 31):

```css
html, body {
  font-family: var(--font-display);
  letter-spacing: -0.16px;
  background: #ffffff;
  color: #000000;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

Replace it with:

```css
html, body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--sans);
  font-feature-settings: "ss01", "cv11";
  letter-spacing: 0.16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
```

- [ ] **Step 5: Smoke-check the dev server**

Start the dev server (or rely on hot reload if already running):

```bash
cd frontend && pnpm dev
```

Open `http://localhost:3000`. The page background should be warm-near-black (`#0c0a09`). Text on the existing landing will be hard to read (light-mode text on dark canvas) — that's expected, you'll rewrite the page in Task 8. **The page should still load without compile errors.**

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add SP1 tokens, @theme bindings, and dark base body"
```

---

### Task 3: Add slate + button + chip + uc + hairline + kbd primitives

**Files:**
- Modify: `frontend/app/globals.css` — append all rules below the `html, body` rule, before the existing `.bg-pastel-cloud` rule.

**Why:** These are the foundational interactive + label primitives used by the new landing's slate top bar and form. Defined as plain CSS classes (not Tailwind utilities) per the spec's hybrid approach.

- [ ] **Step 1: Append primitive component classes**

Insert this block in `frontend/app/globals.css` immediately after the new `html, body` rule (and before the legacy `.bg-pastel-cloud` rule):

```css
/* ─── Type primitives ─────────────────────────── */
.uc {
  text-transform: uppercase;
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.96px;
  color: var(--muted);
}

.hairline {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}

.hairline-mono {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--body);
  letter-spacing: 0.13px;
}

.serif-it {
  font-family: var(--serif);
  font-weight: 300;
  font-style: normal;
  color: var(--ink);
  letter-spacing: -0.01em;
}

/* ─── Slate (top bar) ─────────────────────────── */
.slate {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 32px;
  background: var(--canvas);
  border-bottom: 1px solid var(--hairline);
  font-family: var(--sans);
  font-size: 14px;
  color: var(--body);
  letter-spacing: 0.14px;
}
.slate .dot {
  width: 8px;
  height: 8px;
  background: radial-gradient(circle at 30% 30%, var(--grad-peach), var(--grad-rose));
  border-radius: 50%;
}
.slate .sep { flex: 1; height: 1px; background: transparent; }
.slate .tc  { color: var(--muted); font-size: 13px; letter-spacing: 0.13px; }
.slate b {
  color: var(--ink);
  font-family: var(--sans);
  font-style: normal;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
}

/* ─── Buttons ─────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  height: 40px;
  border: 1px solid var(--hairline-strong);
  background: transparent;
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0;
  cursor: pointer;
  border-radius: var(--r-pill);
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary {
  background: var(--ink);
  border-color: var(--ink);
  color: var(--on-primary);
}
.btn-primary:hover:not(:disabled) {
  background: #ffffff;
  border-color: #ffffff;
}
.btn-ghost {
  background: transparent;
  border-color: var(--hairline-strong);
  color: var(--ink);
}

/* ─── Chips ───────────────────────────────────── */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-pill);
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--body);
  background: var(--surface-strong);
}
.chip .num { color: var(--ink); font-weight: 700; }
.chip-amber {
  background: color-mix(in oklab, var(--grad-peach) 18%, var(--surface-strong));
  border-color: color-mix(in oklab, var(--grad-peach) 30%, transparent);
  color: var(--grad-peach);
}
.chip-cyan {
  background: color-mix(in oklab, var(--grad-sky) 16%, var(--surface-strong));
  border-color: color-mix(in oklab, var(--grad-sky) 30%, transparent);
  color: var(--grad-sky);
}
.chip-dim { color: var(--muted); }

/* ─── Keyboard chip ───────────────────────────── */
.kbd {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 500;
  padding: 3px 8px;
  border: 1px solid var(--hairline-strong);
  border-radius: 6px;
  color: var(--body);
  background: var(--surface-strong);
}
```

- [ ] **Step 2: Smoke-check the dev server**

Hot reload should pick up the change. Page rendering doesn't change yet (these classes aren't applied to anything), but **no compile errors should appear** in the terminal or browser console.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add slate, button, chip, kbd, uc, hairline primitives"
```

---

### Task 4: Add frame, surface helpers, orb classes, and orb-drift animation

**Files:**
- Modify: `frontend/app/globals.css` — append after the primitives from Task 3.

**Why:** The orb classes are the only "voltage" of the new design — pastel radial gradients with a slow drift animation. The `.frame` class establishes the positioned ancestor needed to contain the absolute orbs.

- [ ] **Step 1: Append orb + frame classes**

Append this block in `frontend/app/globals.css` after the kbd rule from Task 3:

```css
/* ─── Frame & surface helpers ─────────────────── */
.frame { position: relative; overflow: hidden; }
.surface-dark { background: var(--canvas); color: var(--ink); }

/* ─── Atmospheric gradient orb ────────────────── */
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.55;
  pointer-events: none;
  z-index: 0;
  animation: orb-drift 40s ease-in-out infinite alternate;
}
.orb.mint     { background: radial-gradient(circle, var(--grad-mint),     transparent 70%); }
.orb.peach    { background: radial-gradient(circle, var(--grad-peach),    transparent 70%); }
.orb.lavender { background: radial-gradient(circle, var(--grad-lavender), transparent 70%); }
.orb.sky      { background: radial-gradient(circle, var(--grad-sky),      transparent 70%); }
.orb.rose     { background: radial-gradient(circle, var(--grad-rose),     transparent 70%); }

@keyframes orb-drift {
  from { transform: translate3d(0, 0, 0)      scale(1);    }
  to   { transform: translate3d(2%, -1.5%, 0) scale(1.04); }
}

@media (prefers-reduced-motion: reduce) {
  .orb { animation: none; }
}
```

Note: The legacy `@media (prefers-reduced-motion: reduce)` rule near the bottom of `globals.css` already disables animations universally with `animation-duration: 0.001ms`. The new rule here is redundant but explicit — leave both, the new one is more readable for the orb-specific case.

- [ ] **Step 2: Smoke-check**

Hot reload. No visible change yet (orbs aren't rendered yet), no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add orb classes and orb-drift animation"
```

---

### Task 5: Add cite-card, url-form, error, and footer-strip classes

**Files:**
- Modify: `frontend/app/globals.css` — append after the orb block from Task 4.

**Why:** These are the remaining content components used by the new landing — the cite-cards in the right column, the url-form input, the error message, and the footer-strip 5-step pipeline preview.

- [ ] **Step 1: Append remaining component classes**

Append in `frontend/app/globals.css` after the orb-drift block:

```css
/* ─── Cite cards (right column) ───────────────── */
.cite-card {
  background: var(--surface-card);
  border: 1px solid var(--hairline);
  border-radius: var(--r-2);
  padding: 20px 22px;
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  transition: border-color 0.18s ease;
}
.cite-card h4 {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 300;
  color: var(--ink);
  margin: 6px 0 4px;
  letter-spacing: -0.22px;
  line-height: 1.18;
}
.cite-card .arrow {
  position: absolute;
  top: 18px;
  right: 20px;
  color: var(--body);
  font-size: 14px;
}
.cite-card-disabled { cursor: default; }
.cite-card-disabled:hover { border-color: var(--hairline); }

.cite-stack { display: flex; flex-direction: column; gap: 12px; }

/* ─── URL form (.url-form) ────────────────────── */
.url-form {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--r-pill);
  padding: 4px 4px 4px 16px;
  background: var(--canvas-soft);
  max-width: 640px;
  width: 100%;
  transition: border-color 0.2s ease;
}
.url-form:focus-within { border-color: var(--ink); }
.url-form .pre {
  text-transform: uppercase;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.96px;
  color: var(--muted);
  white-space: nowrap;
  font-family: var(--sans);
}
.url-form input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  padding: 12px 8px;
  font-size: 16px;
  font-family: var(--sans);
  letter-spacing: 0;
  min-width: 0;
}
.url-form input::placeholder { color: var(--muted-soft); }
.url-form .btn-primary { flex-shrink: 0; }

/* Error message */
.error {
  display: inline-block;
  margin-top: 12px;
  color: var(--error);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  font-family: var(--sans);
}

/* ─── Footer-strip (5-step pipeline preview) ──── */
.footer-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 24px;
  padding: 32px 64px;
  border-top: 1px solid var(--hairline);
  background: var(--canvas);
}
.footer-strip > div {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.footer-strip .step {
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.96px;
  color: var(--muted);
}
.footer-strip .num {
  font-family: var(--serif);
  font-style: normal;
  font-weight: 300;
  font-size: 22px;
  color: var(--ink);
  letter-spacing: -0.22px;
  line-height: 1.1;
}
.footer-strip .desc {
  font-family: var(--sans);
  font-size: 13px;
  color: var(--body);
  letter-spacing: 0.13px;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .footer-strip {
    grid-template-columns: 1fr;
    padding: 24px 32px;
    gap: 18px;
  }
}
```

- [ ] **Step 2: Smoke-check**

Hot reload. No visible change yet. No errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add cite-card, url-form, error, footer-strip classes"
```

---

### Task 6: Add mobile slate hide rules

**Files:**
- Modify: `frontend/app/globals.css` — append after the footer-strip rules from Task 5.

**Why:** The slate is dense (dot + brand + version + scene + date + timecode + Docs + GitHub). At `<640px` it would wrap badly. We hide everything decorative except the brand, the dot, and the date.

- [ ] **Step 1: Append mobile slate rules**

Append in `frontend/app/globals.css`:

```css
/* ─── Slate mobile (≤ 640px): keep brand + dot + date only ─── */
@media (max-width: 639px) {
  .slate {
    padding: 14px 20px;
    gap: 12px;
    flex-wrap: nowrap;
  }
  .slate .slate-version,
  .slate .slate-scene,
  .slate .slate-timecode,
  .slate .slate-docs,
  .slate .slate-github { display: none; }
  .slate .sep:not(:first-of-type) { display: none; }
}
```

Note: this rule relies on the page markup adding semantic classes (`.slate-version`, `.slate-scene`, etc.) on the relevant `<span>` elements. Task 8 will add those classes when writing the Slate JSX.

- [ ] **Step 2: Smoke-check**

Hot reload. No visible change. No errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat(frontend): add slate mobile hide rules"
```

---

### Task 7: Rewrite HeroForm.tsx with .url-form markup

**Files:**
- Modify: `frontend/components/HeroForm.tsx` (full file rewrite)
- Reference (do not modify): `frontend/components/HeroForm.test.tsx`

**Why:** The form's markup must match `.url-form` styling. The component's logic — state names (`url`, `busy`, `error`), `startAnalysis` import, submit handler — is preserved exactly so the existing tests pass without modification.

- [ ] **Step 1: Replace `frontend/components/HeroForm.tsx`**

```tsx
"use client";
import { useState } from "react";
import { startAnalysis, type StartAnalysisResponse } from "@/lib/api";

export function HeroForm({
  onSubmit,
}: {
  onSubmit: (r: StartAnalysisResponse) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await startAnalysis(url);
      onSubmit(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="url-form">
        <span className="pre">paste url →</span>
        <input
          id="hero-youtube-url"
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          autoComplete="off"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary"
        >
          <span>{busy ? "Working" : "Decode"}</span>
          {!busy && <span aria-hidden>↵</span>}
        </button>
      </form>
      {error && (
        <span role="alert" className="error">
          ⚠ {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the HeroForm test suite**

Run: `cd frontend && pnpm test --run HeroForm`
Expected: both tests pass — submit + error display.

If a test fails because of the markup change, do NOT change the test. Instead, re-read this task's Step 1 and verify your markup matches exactly. The tests use `getByPlaceholderText(/youtube/i)`, `getByRole("button", { name: /decode/i })`, and `getByRole("alert")` — all three are preserved by the markup above.

- [ ] **Step 3: Run full test suite**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/HeroForm.tsx
git commit -m "feat(frontend): rewrite HeroForm with .url-form markup, preserve logic"
```

---

### Task 8: Rewrite the landing page

**Files:**
- Modify: `frontend/app/page.tsx` (full file rewrite — replace 175 lines with ~140)

**Why:** This is the main visual deliverable — the new landing in production. Slate top bar, hero with serif "quotation" accent, url-form, cite-stack right column with 4 static demo entries, footer-strip 5-step pipeline preview. All wrapped in a `.frame` with 3 ambient orbs.

- [ ] **Step 1: Replace `frontend/app/page.tsx`**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";

const RECENT_QUOTATIONS_DEMO = [
  { time: "00:42", verdict: "confirmed" as const,   title: "Le faux miroir",                creator: "René Magritte",    year: 1929, type: "Painting" },
  { time: "01:18", verdict: "confirmed" as const,   title: "The Calling of Saint Matthew", creator: "Caravaggio",       year: 1600, type: "Painting" },
  { time: "02:04", verdict: "speculative" as const, title: "Stalker",                      creator: "Andrei Tarkovsky", year: 1979, type: "Film"     },
  { time: "02:51", verdict: "confirmed" as const,   title: "Meshes of the Afternoon",      creator: "Maya Deren",       year: 1943, type: "Film"     },
];
// TODO(SP6): replace RECENT_QUOTATIONS_DEMO with dynamic GET /api/recent-references
// once the endpoint exists. Until then, this is curated demo content.

const STEPS = [
  { step: "01 — ingest",    tool: "yt-dlp",             desc: "Pulls the clip at 480p plus auto-captions if available." },
  { step: "02 — shots",     tool: "PySceneDetect",      desc: "Cuts on shot boundaries; one keyframe per shot, capped at 80." },
  { step: "03 — vision",    tool: "Nemotron Nano VL",   desc: "Composition, palette, camera, costume — evidence only." },
  { step: "04 — cross-ref", tool: "Llama 3.x",          desc: "Names the works the frames may be quoting." },
  { step: "05 — verify",    tool: "Adversarial + Wiki", desc: "A second pass defends each claim. Wikipedia confirms it exists." },
];

function Slate() {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10).replaceAll("-", "·"));
  }, []);
  return (
    <div className="slate">
      <span className="dot" />
      <b>ClipDecoder</b>
      <span className="slate-version">v0.1 · local-first · NIM</span>
      <span className="sep" />
      <span className="tc slate-scene">scene 01 · take 01</span>
      <span className="tc">{today || " "}</span>
      <span className="tc slate-timecode">00:00:00:00</span>
      <span className="sep" />
      <span className="slate-docs">Docs</span>
      <span className="slate-github">GitHub ↗</span>
    </div>
  );
}

function Stage({ onSubmit }: { onSubmit: (id: string) => void }) {
  return (
    <section
      className="relative grid gap-12 lg:grid-cols-[1fr_400px]"
      style={{ padding: "clamp(32px, 5vw, 64px)", paddingTop: 48, paddingBottom: 48 }}
    >
      {/* Left column — hero */}
      <div>
        <div className="hairline" style={{ marginBottom: 18 }}>
          A local tool · NIM · Wikipedia-verified
        </div>
        <h1
          className="serif-it"
          style={{
            fontSize: "clamp(72px, 9vw, 144px)",
            lineHeight: 0.96,
            margin: 0,
          }}
        >
          Every shot
          <br />
          is a{" "}
          <em style={{ color: "var(--grad-lavender)", fontStyle: "italic" }}>
            quotation.
          </em>
          <span
            style={{
              display: "block",
              fontSize: "0.36em",
              marginTop: 24,
              color: "var(--body)",
              fontStyle: "normal",
            }}
          >
            We name the source.
          </span>
        </h1>

        <p
          style={{
            maxWidth: 640,
            marginTop: 32,
            fontSize: 18,
            lineHeight: 1.5,
            color: "var(--body)",
            letterSpacing: 0.18,
          }}
        >
          Paste a music video. ClipDecoder splits it into shots, asks a vision
          model what it sees, then cross-references each frame against a library
          of films, paintings, photographs, and other clips — returning
          evidence-grounded candidates the artist may be quoting.
        </p>

        <div style={{ marginTop: 32 }}>
          <HeroForm onSubmit={(r) => onSubmit(r.youtube_id)} />
        </div>

        <div
          style={{
            marginTop: 20,
            display: "flex",
            flexWrap: "wrap",
            gap: 24,
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--body)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="kbd">⌘ V</span> paste from clipboard
          </span>
          <span>YouTube only · 480p · ~90s analysis</span>
        </div>
      </div>

      {/* Right column — recent quotations (static demo, see TODO) */}
      <aside>
        <div className="hairline" style={{ marginBottom: 10, paddingLeft: 4 }}>
          Recent quotations we've found
        </div>
        <div className="cite-stack">
          {RECENT_QUOTATIONS_DEMO.map((q) => (
            <button
              key={`${q.time}-${q.title}`}
              type="button"
              disabled
              aria-disabled="true"
              className={`cite-card cite-card-disabled${q.verdict === "speculative" ? " cite-card-speculative" : ""}`}
              style={
                q.verdict === "speculative"
                  ? { borderStyle: "dashed", opacity: 0.9 }
                  : undefined
              }
            >
              <div
                className="tc"
                style={
                  q.verdict === "speculative"
                    ? { color: "var(--grad-sky)", fontSize: 13, letterSpacing: 0.13 }
                    : { color: "var(--muted)", fontSize: 13, letterSpacing: 0.13 }
                }
              >
                {q.time} · {q.verdict}
              </div>
              <h4>{q.title}</h4>
              <div style={{ fontSize: 13, color: "var(--body)", letterSpacing: 0.13 }}>
                {q.creator} · {q.year} · {q.type}
              </div>
              <span className="arrow">↗</span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function FooterStrip() {
  return (
    <footer className="footer-strip">
      {STEPS.map((s) => (
        <div key={s.step}>
          <span className="step">{s.step}</span>
          <span className="num">{s.tool}</span>
          <span className="desc">{s.desc}</span>
        </div>
      ))}
    </footer>
  );
}

export default function Home() {
  const router = useRouter();
  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      {/* Ambient orbs — only "voltage" of the new design */}
      <div
        className="orb peach"
        style={{ top: -120, right: -80, width: 480, height: 480 }}
      />
      <div
        className="orb lavender"
        style={{ bottom: -160, left: -100, width: 560, height: 560, animationDelay: "-12s" }}
      />
      <div
        className="orb mint"
        style={{ top: "40%", left: "30%", width: 320, height: 320, opacity: 0.35, animationDelay: "-26s" }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>
        <Slate />
        <div style={{ flex: 1 }}>
          <Stage onSubmit={(id) => router.push(`/report/${id}`)} />
        </div>
        <FooterStrip />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Smoke-check the dev server**

Hot reload. Open `http://localhost:3000`. You should see:
- Top bar (slate) with peach dot, "ClipDecoder" in white, version line, decorative scene · take · date · timecode, Docs / GitHub
- Hero h1 in EB Garamond italic with "quotation." in lavender, "We name the source." subtitle below
- Lede paragraph in body color
- URL form as a white-pill input with "paste url →" prefix
- ⌘V kbd badge + help text
- Right column "Recent quotations" with 4 cards, the Stalker one with dashed border
- Footer strip 5 steps at the bottom
- 3 pastel orbs softly glowing in the background, drifting very slowly

If you see compile errors: read them, fix per the code above. If a className is missing, check that Task 3–6 globals.css edits all landed.

- [ ] **Step 3: Verify form submit works**

In the browser, paste a YouTube URL (e.g. `https://www.youtube.com/watch?v=QHuo2pIyTH8`) and click Decode. Expected: button shows "Working", then redirect to `/report/{id}`. Report page renders (visually broken — accepted) and SSE stream begins.

If submit fails or redirect doesn't happen: this means the HeroForm wiring broke. Check that `onSubmit={(r) => onSubmit(r.youtube_id)}` in `Stage` correctly forwards the id, and that `Home` passes `(id) => router.push(\`/report/${id}\`)`.

- [ ] **Step 4: Run full test suite**

Run: `cd frontend && pnpm test --run`
Expected: all tests green. The HeroForm tests still match because button text and placeholder are unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat(frontend): rewrite landing page with new editorial design"
```

---

### Task 9: Drop unused `.reveal` rules from globals.css

**Files:**
- Modify: `frontend/app/globals.css` — delete the `.reveal` and `.reveal-child` rules and their `@keyframes reveal-up`.

**Why:** These were used only on the old landing's hero entrance. The new landing doesn't use them. They're not referenced by the report subtree (verify with grep below). Removing them now keeps `globals.css` honest.

- [ ] **Step 1: Verify `.reveal` is not used outside the (already-rewritten) landing**

Run:
```bash
cd /home/louis/clip-decoder/frontend && grep -rn "reveal-child\|reveal\b" app components --include='*.tsx' --include='*.ts'
```
Expected: zero hits (the old `page.tsx` was rewritten in Task 8).

If hits appear: do NOT delete. Leave the `.reveal` rules in place and skip this task entirely (move to Task 10).

- [ ] **Step 2: Delete the rules**

In `frontend/app/globals.css`, delete this block (currently around lines 281–293):

```css
/* Stagger reveal — applied to children with .reveal-child */
.reveal {
  --d: 0ms;
}
.reveal-child {
  opacity: 0;
  transform: translateY(12px);
  animation: reveal-up 0.9s cubic-bezier(0.2, 0.7, 0.1, 1) forwards;
  animation-delay: var(--d, 0ms);
}
@keyframes reveal-up {
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Smoke-check + tests**

Run: `cd frontend && pnpm test --run`
Expected: all tests green.

Open `http://localhost:3000`. Page should look identical to after Task 8.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/globals.css
git commit -m "chore(frontend): drop unused .reveal animation rules"
```

---

### Task 10: Final grep audit, manual verification, and final review

**Files:**
- No modifications expected. This task is verification + a possible cleanup commit.

**Why:** Catch any stray references to old tokens / classes that the implementer may have missed. Walk through the full manual checklist before declaring SP1 done.

- [ ] **Step 1: Grep audit**

Run from the repo root:
```bash
cd /home/louis/clip-decoder/frontend && \
  grep -rn 'midnight\|magenta\|orange\|mist\|aurora\|bricolage\|plex\|font-display\|font-mono\|tracking-mono-label\|tracking-display\|tracking-body\|reveal-child\|float-slow\|wordmark' \
  app/page.tsx app/layout.tsx components/HeroForm.tsx
```
Expected: zero hits across these three files.

If any hits appear: review them. Each must be either (a) absent and grep is wrong, or (b) a legitimate keep (rare — only if the spec explicitly preserves something). Otherwise edit the file to remove the reference.

- [ ] **Step 2: Run full test suite**

Run: `cd frontend && pnpm test --run`
Expected: all tests pass. Record the count.

- [ ] **Step 3: Manual visual verification**

With dev server running (`pnpm dev` or via Docker), open `http://localhost:3000` and verify:

- [ ] Slate (top bar): peach dot left, "ClipDecoder" bold white, version line, three `.tc` decoratives, "Docs" / "GitHub ↗" right.
- [ ] Hero h1 large EB Garamond italic, "quotation." word in lavender (`#c8b8e0`), "We name the source." subtitle.
- [ ] Lede paragraph in muted body color, max-width readable.
- [ ] URL form: white pill input with prefix "paste url →" in muted uppercase, white pill submit button reading "Decode ↵".
- [ ] Below form: ⌘V kbd badge + "YouTube only · 480p · ~90s analysis" in italic serif.
- [ ] Right column: "Recent quotations" hairline label, 4 cite-cards (Magritte / Caravaggio / Tarkovsky-dashed / Maya Deren).
- [ ] Footer-strip: 5 steps in a row, each with uppercase step label, italic serif tool name, body description.
- [ ] 3 pastel orbs in the background drifting very slowly. Watch for ~10 seconds — you should see imperceptibly slow motion.

- [ ] **Step 4: Responsive check**

Resize the browser window from ~1920px down to ~320px:

- [ ] At 1024px+: two-column stage layout, slate fully visible.
- [ ] At 640–1024px: stage collapses to single column, cite-stack appears below hero. Slate still fully visible.
- [ ] At <640px: slate hides version, scene, timecode, Docs, GitHub. Brand + dot + date remain. Footer-strip stacks vertically.

- [ ] **Step 5: Reduced motion check**

In Chrome DevTools: `Cmd+Shift+P` → "Show Rendering" → "Emulate CSS media feature prefers-reduced-motion: reduce".
Expected: orbs become static (no drift animation).

- [ ] **Step 6: Form submit end-to-end**

In the browser, paste `https://www.youtube.com/watch?v=QHuo2pIyTH8` (or any valid YouTube URL) and click Decode. Verify:

- [ ] Button shows "Working" while submitting.
- [ ] On success: redirect to `/report/{id}`.
- [ ] Report page renders content (visually wrong — accepted, dark canvas + Inter clash with old utilities). The pipeline runs, SSE events stream, report fills in over time.
- [ ] No JavaScript console errors related to the landing or form.

- [ ] **Step 7: Lighthouse contrast spot-check**

In Chrome DevTools → Lighthouse → Accessibility audit on the landing.
Expected: "Background and foreground colors do not have a sufficient contrast ratio" should not flag the body text. (`--body: #a8a29e` on `--canvas: #0c0a09` ≈ 8.8:1, well above AA 4.5:1.)

If it flags something: open the issue, identify the culprit element, and fix its color in `globals.css`. Re-run Lighthouse. Commit fix.

- [ ] **Step 8: If any cleanup commit was needed in steps 1–7**

```bash
git add <changed files>
git commit -m "chore(frontend): cleanup from final SP1 verification"
```

If no changes were needed in steps 1–7, no commit is required for this task.

- [ ] **Step 9: Push the branch (controller decision — don't push from inside the subagent)**

The controller / human will review and decide when to merge `feature/design-system-sp1` into `main`. Do not run `git push` from the subagent.

---

## Self-review (controller-side, not part of subagent execution)

Before dispatching subagents to execute this plan, the controller verifies:

- **Spec coverage** ✅
  - Tokens block (spec §3.1) → Task 2
  - `@theme` block (spec §3.1) → Task 2
  - Body/html base styles (spec §3.1) → Task 2
  - Component classes (slate/btn/chip/orb/cite-card/url-form/serif-it/uc/hairline/kbd/frame/surface-dark) → Tasks 3, 4, 5
  - `@keyframes orb-drift` + `prefers-reduced-motion` → Task 4
  - Mobile slate hide → Task 6
  - EB Garamond + Inter fonts → Task 1
  - HeroForm rewrite preserving state names + tests → Task 7
  - `app/page.tsx` rewrite (Slate, Stage with hero + cite-stack, FooterStrip, 3 orbs) → Task 8
  - "Recent quotations" 4 static entries with TODO comment → Task 8
  - "Cosmos Reason" → "Nemotron Nano VL" → Task 8
  - Inline-style fallback for grad-lavender accent → Task 8
  - Cite-cards as `<button disabled>` not `<a href="#">` → Task 8
  - Old tokens kept in `tailwind.config.ts` (no Task — the file isn't touched, which is the spec's intent)
  - Old component classes kept in `globals.css` (no Task — Tasks 2–6 only **add**, the only deletion is `.reveal` in Task 9 which is verified unused)
  - Grep audit + manual checklist → Task 10
  - Reduced-motion compliance → Task 4 + Task 10

- **Placeholder scan** ✅ — No "TBD", "implement later", or vague language. Every code step contains the exact code. Every verification step has the exact command and expected outcome.

- **Type consistency** ✅
  - `RECENT_QUOTATIONS_DEMO` defined once (Task 8), no later task references its shape.
  - `Stage` props shape `{ onSubmit: (id: string) => void }` defined and used consistently in Task 8.
  - `HeroForm` props shape `{ onSubmit: (r: StartAnalysisResponse) => void }` (Task 7) — `Stage` adapts via `(r) => onSubmit(r.youtube_id)` (Task 8). Matches.
  - State variables `url`, `busy`, `error` are defined in Task 7 only; Task 7 explicitly forbids renaming them.

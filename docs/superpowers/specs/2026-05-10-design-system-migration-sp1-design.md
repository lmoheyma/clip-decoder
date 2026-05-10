# Design System Migration — Sub-project 1: Landing reskin

> First sub-project of a 5-sub-project refactor based on a new design provided by the user (`index.html` + `styles.css` at repo root, untracked, kept as authoring reference).
>
> SP1 = install new design tokens + fonts + component primitives, and reskin the landing page only. Report stays on the old design until SP2.

## Goal

Migrate the frontend visual identity from the current "tech-forward" aesthetic (Bricolage Grotesque + IBM Plex Mono + magenta/orange voltage on light canvas) to the new "editorial register" aesthetic (EB Garamond 300 + Inter + pastel ambient orbs on warm-near-black canvas), restricted to the landing page in this sub-project.

## Non-goals

- Reskin of the report page (`/report/*`) — explicitly deferred to SP2.
- Dynamic "Recent quotations" section — deferred to SP6 or later (sub-project numbering tentative).
- New pages from the new design (Pipeline live, Reference detail, Error) — deferred to SP3, SP4, SP5.
- Any backend changes (endpoints, SSE events, models, prompts).

## Decisions matrix

| Decision | Choice | Rationale |
|---|---|---|
| Scope of SP1 | Landing only; report stays on old design | Report will be redone in SP2 with new features; double-reskin is wasted work |
| Token integration | Hybrid: Tailwind v4 `@theme` for tokens + plain CSS component classes for distinctive motifs | Utilities for one-shot layout; component classes for repeated motifs (`.orb`, `.serif-it`, `.cite-card`, `.btn`) |
| Report visual during SP1 | Cutover global; both old and new component classes coexist in `globals.css` until SP2 drops the old | Old utility classes (`bg-deep-sky`, `text-aurora`, `glass-light`, `marquee`, `wordmark-foot`, `shadow-aurora`, `font-display`, `tracking-mono-label`, etc.) and old keyframes (`drift`) **stay** so the report continues rendering its layout. Only the `body { background: var(--canvas) }` global makes the report look chromatically wrong — that's the accepted breakage. Functional regression of the report is **not** accepted. |
| "Recent quotations" section | Static demo with TODO comment | Avoid empty/poor section if dynamic; mark for future activation |
| Fonts | EB Garamond 300 (display) + Inter (sans + mono); drop Bricolage Grotesque + IBM Plex Mono | Strict editorial register; intentional absence of monospace per design |
| Motion | Very subtle ambient orb drift (40s+) only; no reveal staggered, no marquee | Editorial register is quiet; one slow motion adds life without violating tone |

## Architecture

### Files modified

#### `frontend/app/globals.css` (full rewrite)

Replace existing `:root` tokens (`--color-midnight`, `--color-lavender`, `--color-magenta`, `--color-orange`, `--color-mist`, `--shadow-midnight*`, `--shadow-aurora`) with new tokens from `styles.css`:

```css
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

  /* Type
     Note: no `--mono`. The new design uses Inter for everything;
     the absence of monospace is intentional. The few "technical"
     elements (`.kbd`, `.tc`, `.uc`) achieve a forensic feel via
     uppercase + letter-spacing on Inter, not via a true mono font. */
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

These are also exposed via Tailwind v4 `@theme` block so utility classes are auto-generated:

```css
@theme {
  --color-canvas: var(--canvas);
  --color-canvas-soft: var(--canvas-soft);
  --color-surface-card: var(--surface-card);
  --color-surface-strong: var(--surface-strong);
  --color-ink: var(--ink);
  --color-body: var(--body);
  --color-body-strong: var(--body-strong);
  --color-muted: var(--muted);
  --color-muted-soft: var(--muted-soft);
  --color-grad-mint: var(--grad-mint);
  --color-grad-peach: var(--grad-peach);
  --color-grad-lavender: var(--grad-lavender);
  --color-grad-sky: var(--grad-sky);
  --color-grad-rose: var(--grad-rose);
  --color-success: var(--success);
  --color-error: var(--error);
  --font-sans: var(--sans);
  --font-serif: var(--serif);
  --shadow-1: var(--shadow-1);
  --radius-1: 8px;
  --radius-2: 16px;
  --radius-3: 24px;
  --radius-pill: 9999px;
}
```

Component classes carried over verbatim from `styles.css`:

- `.slate` (top bar layout) and `.slate .dot / .sep / .tc / b`
- `.btn / .btn-primary / .btn-ghost`
- `.chip / .chip-amber / .chip-cyan / .chip-dim` (carried in advance even though landing only uses minor variants — they'll be needed in SP2/SP3)
- `.orb / .orb.mint / .orb.peach / .orb.lavender / .orb.sky / .orb.rose`
- `.serif-it`, `.uc`, `.hairline`, `.hairline-mono`
- `.cite-card` (with `.cite-card h4 / .arrow`)
- `.kbd`
- `.frame` (positioned ancestor for orbs)
- `.surface-dark`, `.surface-helpers` block

**Old classes kept temporarily (used by the report subtree, dropped in SP2)**: `.bg-pastel-cloud`, `.bg-dawn-cloud` (and its `::before` rule), `.bg-deep-sky` (and its `::before` rule), `.text-aurora`, `.glass-light`, `.float-slow`, `.marquee`, `.wordmark-foot`, `.shadow-aurora`, `@keyframes drift`, `.aurora-ring`, `.btn-midnight`, `.rounded-sharp`, `.rounded-comfy`. These stay in `globals.css` alongside the new tokens and component classes throughout SP1. The only old base styling overridden is `html, body { background, color, font-family }` — the new dark canvas + Inter become global, which is exactly the accepted "report looks chromatically wrong" breakage.

**Classes safe to drop** (not used outside the landing): `.reveal*` (only used on landing's hero entrance, which is being rewritten with no animation).

Single new animation:

```css
@keyframes orb-drift {
  from { transform: translate3d(0, 0, 0)        scale(1); }
  to   { transform: translate3d(2%, -1.5%, 0)   scale(1.04); }
}
.orb { animation: orb-drift 40s ease-in-out infinite alternate; }

@media (prefers-reduced-motion: reduce) {
  .orb { animation: none; }
}
```

Body / html base:

```css
html, body {
  background: var(--canvas);
  color: var(--ink);
  font-family: var(--sans);
  font-feature-settings: "ss01", "cv11";
  letter-spacing: 0.16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

#### `frontend/app/layout.tsx` (modify)

Drop `next/font/google` imports for `Bricolage_Grotesque` and `IBM_Plex_Mono` (and their CSS variables `--font-bricolage`, `--font-plex-mono`).

Add:

```tsx
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
```

`<html>` className receives `${ebGaramond.variable} ${inter.variable}`.

#### `frontend/app/page.tsx` (full rewrite)

Markup is a JSX transcription of the `<!-- 01 LANDING -->` block from `index.html`, structured as three sections inside a `.frame` wrapper:

```
<main className="frame relative min-h-screen overflow-hidden">
  <div className="orb peach" style={top:-120, right:-80, width:480, height:480} />
  <div className="orb lavender" style={bottom:-160, left:-100, width:560, height:560, animationDelay: "-12s"} />
  <div className="orb mint" style={top:"40%", left:"30%", width:320, height:320, opacity:0.35, animationDelay: "-26s"} />

  <Slate />        /* top bar */
  <Stage />        /* hero + cite-stack grid */
  <FooterStrip />  /* 5-step pipeline preview */
</main>
```

**Slate** — copy and structure exactly as in `index.html` line 641–652. The date string is computed client-side via `useEffect` to avoid SSR/CSR mismatch:

```tsx
const [today, setToday] = useState("");
useEffect(() => {
  setToday(new Date().toISOString().slice(0, 10).replaceAll("-", "·"));
}, []);
```

`scene 01 · take 01` and `00:00:00:00` are hardcoded decorative literals.

**Stage** — responsive grid:
- `< 1024px` (below `lg`): single column (`grid-cols-1`), cite-stack stacks below the hero.
- `≥ 1024px` (`lg`): two columns `lg:grid-cols-[1fr,400px]`, hero left and cite-stack right (matches index.html `.stage` layout intent).

Padding `clamp(32px, 5vw, 64px)` horizontal, `48px` vertical. Gap `48px`.

Left column:
- `<div class="hairline">A local tool · NIM · Wikipedia-verified</div>`
- `<h1>` with serif-it, font-size `clamp(72px, 9vw, 144px)`, line-height 0.96. "Every shot<br/>is a <em>quotation.</em>" The `<em>` is colored via inline style `style={{ color: "var(--grad-lavender)" }}` (committed approach — does not depend on Tailwind v4 `@theme` correctly auto-generating a `text-grad-lavender` utility). If at implementation time the Tailwind utility is verified to work, prefer the utility class; the inline style is the fallback that's guaranteed to render. Subtitle "We name the source." in `<span class="block text-[0.36em] mt-6 text-body">`.
- `<p class="lede">` with the new copy (full text in index.html line 661–666).
- `<HeroForm onSubmit={(r) => router.push(\`/report/${r.youtube_id}\`)} />`
- `<div class="help" style={fontFamily: "var(--serif)", fontStyle: "italic"}>` containing `<span><span class="kbd">⌘ V</span> paste from clipboard</span>` and `<span>YouTube only · 480p · ~90s analysis</span>`.

Right column (cite-stack):

```tsx
const RECENT_QUOTATIONS_DEMO = [
  { time: "00:42", verdict: "confirmed", title: "Le faux miroir",                creator: "René Magritte",     year: 1929, type: "Painting" },
  { time: "01:18", verdict: "confirmed", title: "The Calling of Saint Matthew", creator: "Caravaggio",        year: 1600, type: "Painting" },
  { time: "02:04", verdict: "speculative", title: "Stalker",                    creator: "Andrei Tarkovsky",  year: 1979, type: "Film" },
  { time: "02:51", verdict: "confirmed", title: "Meshes of the Afternoon",      creator: "Maya Deren",        year: 1943, type: "Film" },
];
// TODO(SP6): replace with dynamic GET /api/recent-references when endpoint exists
```

Each card is rendered as `<button type="button" disabled aria-disabled="true" className="cite-card cite-card-disabled">` for now (not an `<a>` to a dead anchor — keeps the focus order accessible by signaling "not yet interactive"). SP4 (Reference detail) will swap these to `<Link href={`/reference/${id}`}>` once the route exists. The `.cite-card-disabled` rule sets `cursor: default` and removes any future hover affordance.

**FooterStrip** — grid 5 columns, border-top `1px solid var(--hairline)`, padding 32px 64px:

```tsx
const STEPS = [
  { step: "01 — ingest",    tool: "yt-dlp",            description: "Pulls the clip at 480p plus auto-captions if available." },
  { step: "02 — shots",     tool: "PySceneDetect",     description: "Cuts on shot boundaries; one keyframe per shot, capped at 80." },
  { step: "03 — vision",    tool: "Nemotron Nano VL",  description: "Composition, palette, camera, costume — evidence only." },
  { step: "04 — cross-ref", tool: "Llama 3.x",         description: "Names the works the frames may be quoting." },
  { step: "05 — verify",    tool: "Adversarial + Wiki", description: "A second pass defends each claim. Wikipedia confirms it exists." },
];
```

Note: `Cosmos Reason` from the design fixture is replaced with `Nemotron Nano VL` to reflect the actual VLM in use.

Each step:
- `<span class="step uc">` for the step number/name (uppercase tracking)
- `<span class="num serif-it">` for the tool name (italic serif accent)
- `<span class="desc">` for the description (Inter, body color)

#### `frontend/components/HeroForm.tsx` (visual rewrite, logic preserved)

Existing exports and indirections **unchanged**:
- Default export: `function HeroForm({ onSubmit }: { onSubmit: (r: StartAnalysisResponse) => void })`
- Imports: `startAnalysis` from `@/lib/api` (the indirection that wraps the actual `fetch("/api/decode", ...)` call — do not refactor it inline)
- State variables retain their existing names: `url`, `busy`, `error`. **No rename of `busy` to `loading`.**
- Submit handler unchanged: `setBusy(true)` → `await startAnalysis(url)` → `onSubmit(r)` → `setBusy(false)`.

Markup becomes the `.url-form` pattern from `styles.css`:

```tsx
<form className="url-form" onSubmit={submit}>
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
  <button type="submit" className="btn btn-primary" disabled={busy}>
    <span>{busy ? "Working" : "Decode"}</span>
    <span aria-hidden>{busy ? null : "↵"}</span>
  </button>
</form>
{error && <span role="alert" className="error">⚠ {error}</span>}
```

Notes:
- Button text remains `"Decode"` / `"Working"` (preserves the existing `getByRole("button", { name: /decode/i })` test selector unchanged).
- The error span retains `role="alert"` (preserves the existing `getByRole("alert")` test).
- Placeholder remains `"https://www.youtube.com/watch?v=..."` (preserves `getByPlaceholderText(/youtube/i)`).
- The decorative `↵` glyph and the `Working` text are inside `<span>` so screen readers don't read the glyph as content.

`.url-form` styles to be added in `globals.css`: flex row, `align-items: center`, `border: 1px solid var(--hairline-strong)`, `border-radius: var(--r-pill)`, `padding: 4px 4px 4px 16px`, `background: var(--canvas-soft)`, with:
- `.url-form .pre` — `text-transform: uppercase; font-size: 12px; letter-spacing: 0.96px; color: var(--muted)`
- `.url-form input` — `flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); padding: 12px 8px; font-size: 16px; font-family: var(--sans)`, with `::placeholder { color: var(--muted-soft) }`
- `.url-form button.btn-primary` — already styled by `.btn` + `.btn-primary` rules (white pill).
- `.error` — `color: var(--error); font-size: 12px; text-transform: uppercase; letter-spacing: 0.96px; font-family: var(--sans)`

#### `frontend/tailwind.config.ts` (modify, but keep old tokens)

The old tokens (`midnight`, `lavender`, `magenta`, `orange`, `mist` colors; `bricolage` / `plex-mono` font families; `aurora` shadow) are **kept in place** during SP1 because the report components (`PipelineStatus`, `ReferenceCard`, etc.) still reference them via Tailwind utility classes (`bg-midnight`, `text-magenta`...). They will be removed in SP2 once the report is reskinned.

This file is touched only if Tailwind v4 requires explicit theme registration of the new tokens beyond what `@theme` provides — likely not needed.

### Files unchanged

- `frontend/app/report/**/*` — entire report subtree
- `frontend/components/PipelineStatus.tsx`, `ReferenceCard.tsx`, `ReferencePanel.tsx`, `ConfidenceFilter.tsx`, `VideoPlayer.tsx` — all report-side components
- All test files (logic tests pass without modification; classname-matching tests in `HeroForm.test.tsx` may need minor updates — see Testing)
- All backend code

### Files at repo root (untracked, kept as reference)

- `index.html` — full design fixture from Claude Design (5 pages mocked up)
- `styles.css` — token + component definitions

These are the **authoring reference**. Do not delete during SP1 or any subsequent SP. They guide all 5 sub-projects and are useful to consult when implementing each new piece.

## Component / data flow

No data flow changes. The landing remains a static page with one client-side form. Submit POST → `/api/decode` (existing endpoint, unchanged) → response with `youtube_id` → `router.push('/report/{id}')`.

## Error handling

No new error paths. HeroForm error states (network failure, invalid URL, backend 4xx/5xx) display inline below the form, styled with the new `--error` token color. Error message component wrapped in `<div class="error" role="alert">` for accessibility.

## Testing strategy

**Existing tests that must continue passing — no test code changes required**:
- `HeroForm.test.tsx` — uses semantic queries: `getByPlaceholderText(/youtube/i)`, `getByRole("button", { name: /decode/i })`, `getByRole("alert")`. The new markup preserves all three (placeholder is `https://www.youtube.com/watch?v=...`, button text is `"Decode"`, error span has `role="alert"`). No assertion needs updating.
- `PipelineStatus.test.tsx`, `ReferencePanel.test.tsx`, `VideoPlayer.test.tsx` — entirely unchanged (no source change to these components).

**No new tests introduced.** This is a pure visual reskin; the underlying logic is unchanged. Visual changes are verified manually:

**Manual verification checklist** (run after implementation):
1. `pnpm dev` (or `docker compose up`), open `http://localhost:3000`. New landing renders: slate top bar, serif hero with "quotation" lavender accent, url-form, right column cite-cards, footer-strip 5 steps.
2. No JS console errors, no React hydration warnings.
3. Submit a valid YouTube URL → redirects to `/report/{id}`. Report loads (visually broken — accepted), SSE stream starts, pipeline runs to completion.
4. Resize 320px → 1920px. No layout breakage. Mobile (≤640px) hides slate decorative `.tc` spans except date; cite-stack collapses below hero.
5. DevTools → Performance: orb-drift animation runs at 60fps, GPU-composited (transform + opacity).
6. Set `prefers-reduced-motion: reduce` in OS / DevTools → orbs become static.
7. Lighthouse accessibility: contrast on body text (`--body: #a8a29e` on `--canvas: #0c0a09`) passes AA (≥4.5:1).

## Edge cases

1. **Hydration mismatch on date string** — date is computed in `useEffect` (client-only) to avoid SSR producing one date and client another. Empty string rendered server-side.
2. **Font fallback during load** — `display: 'swap'` accepted; brief Times/Helvetica flash on first render. No FOIT, no layout shift since `next/font` reserves space.
3. **`color-mix(in oklab, ...)` in `.chip-amber / .chip-cyan`** — fails silently in Safari < 16.4 and Firefox < 113. Fallback rendering = solid border-color and color from non-mixed stops. Acceptable degradation; landing doesn't use chips, so visible only when SP2 brings them in.
4. **Reduced motion** — `@media (prefers-reduced-motion: reduce) { .orb { animation: none; } }` ensures accessibility compliance.
5. **Report page visual breakage during SP1** — accepted (decision matrix, choice B). The `body { background: var(--canvas) }` global makes the report look wrong. Mitigation: none. This is the explicit cost of cutover migration; resolved by SP2.
6. **Mobile slate wrap** — at `<640px`, slate hides via CSS `display: none`:
   - The `scene 01 · take 01` `<span class="tc">` element
   - The `00:00:00:00` `<span class="tc">` element
   - The "Docs" and "GitHub ↗" `<span>` links
   - The version line `v0.1 · local-first · NIM`
   What stays visible: the peach `.dot`, `<b>ClipDecoder</b>`, the date `<span class="tc">` (so the slate retains some informational content). Implemented via `@media (max-width: 639px)` rules in `globals.css` targeting these elements by class + position (e.g., `.slate .tc:not(:nth-of-type(2))` to hide all `.tc` except the date which is the second one rendered).
7. **JS disabled** — page renders correctly (markup is static). Form submit triggers a default POST that returns JSON; user sees raw response. Not a priority but markup remains semantic.
8. **EB Garamond CDN failure** — fallback to "GT Sectra", then Times New Roman. Visual character lost but text remains legible.

## Done criteria

SP1 is complete when:

- ✅ `globals.css` rewritten with new tokens in `:root` and `@theme`, plus all component classes from `styles.css` (`.slate`, `.btn`, `.chip`, `.orb`, `.cite-card`, `.url-form`, `.serif-it`, `.uc`, `.hairline`, `.hairline-mono`, `.kbd`, `.frame`, `.surface-dark`).
- ✅ Single `@keyframes orb-drift` animation defined, applied to `.orb`, respects `prefers-reduced-motion`.
- ✅ `layout.tsx` imports `EB_Garamond` (300, normal+italic) and `Inter` (400/500/600/700) via `next/font/google` with `--font-eb-garamond` and `--font-inter` variables; no references to `Bricolage_Grotesque` or `IBM_Plex_Mono`.
- ✅ `app/page.tsx` rewritten as the new landing: `<main class="frame">` containing 3 absolute `.orb` divs, `Slate`, `Stage` (hero left + cite-stack right), `FooterStrip` (5 steps).
- ✅ `Slate` includes peach→rose `.dot`, "ClipDecoder" + version, decorative `scene 01 · take 01` + client-computed date + static `00:00:00:00`, "Docs" + "GitHub ↗" links.
- ✅ Hero h1 uses `.serif-it` with "quotation" word in `text-grad-lavender`, includes lede paragraph and help row with `<span class="kbd">⌘ V</span>`.
- ✅ Right cite-stack contains exactly 4 hardcoded `RECENT_QUOTATIONS_DEMO` entries with `// TODO(SP6)` comment.
- ✅ FooterStrip uses 5 `STEPS` entries with `Nemotron Nano VL` substituted for `Cosmos Reason`.
- ✅ `HeroForm.tsx` rewritten with `.url-form` markup, `.btn-primary` submit button, all existing submit/loading/error logic preserved.
- ✅ `tailwind.config.ts`: old tokens (midnight/lavender/magenta/orange/mist/aurora) **retained** for report compatibility during SP1.
- ✅ All existing tests pass: `cd frontend && pnpm test`. (Any classname-matching assertion in `HeroForm.test.tsx` updated to new class names.)
- ✅ Manual verification checklist (above) passes end-to-end.
- ✅ Work on branch `feature/design-system-sp1`, merged into `main` after final review.

## Risks

- **Report visual disgrace during SP1 dev cycle** — accepted up front (option B in decision matrix). Mitigation: keep SP1 short (1–2 days) and roll into SP2 quickly so the dev experience isn't degraded for long.
- **EB Garamond Google Fonts CDN unreliability** — rare; fallback chain handles it. No mitigation needed.
- **Tailwind v4 `@theme` block edge cases** (Tailwind v4 is in beta) — if `@theme` doesn't generate the expected utilities for `--color-grad-lavender`, fall back to defining colors in `tailwind.config.ts` `theme.extend.colors`. This is a known v4 quirk.
- **Hidden references to old tokens in components I didn't audit** — e.g., a stray `bg-mist` somewhere. Mitigation: grep `frontend/` for `midnight|lavender|magenta|orange|mist|aurora|bricolage|plex|font-display|font-mono|tracking-mono-label|tracking-display|tracking-body|reveal-child|float-slow|marquee|wordmark` after the rewrite and ensure all hits are inside (a) the report subtree, (b) `tailwind.config.ts` (kept-for-report), or (c) `globals.css` kept-for-report block. No hits should remain in `app/page.tsx`, `app/layout.tsx`, or `components/HeroForm.tsx`.

## Out of scope

- Backend changes
- Report reskin
- Any new pages
- Dynamic data on landing
- New tests
- Adoption of the chip / pipeline-row / ref / cite-card classes on the report (those classes are *defined* in `globals.css` for SP2 use, but no report markup adopts them yet)

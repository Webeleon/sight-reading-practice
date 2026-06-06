# Sight Reading — product design reference

HTML mockups for the redesign + GitHub Pages landing page. Built to test the
market: *"learning to sight-read on your guitar is hard — here's the solution
to practice and see the results."*

Open **`index.html`** for the hub (live previews + the design system).

## Files

| File | What it is |
|------|------------|
| `index.html` | Reference hub — design system + links/previews to everything |
| `landing.html` | The GitHub Pages landing page (story + email-gated download) |
| `app.html` | The desktop app — 4 screens as artboards |
| `signal-tape.css` | Shared design system (tokens, textures, components, motion) |
| `direction-signal-tape.html` | The single-direction preview that locked the look |
| `brand-directions-v2.html` | Exploration — 4 concept directions (A–D) |
| `brand-directions.html` | Exploration — first 3 (rejected) directions |

> These are a **design reference**, not the product. The app itself stays the
> Electron/React prototype; this is the visual target to build toward.

## Direction — "Signal Tape" (concepts C × D)

Record-sleeve austerity warmed by analog-studio riso.

- **Structure** (from C / Signal): strict Swiss grid, oversized `Archivo Black`
  display, crop-mark corners, ruthless whitespace, notation as diagram.
- **Warmth** (from D / Practice Tape): bone/newsprint paper, halftone + grain
  textures, `DM Mono` "console" captions, tape labels, and the **VU meter** as
  the signature live-feedback element.

### Colour logic (two-colour discipline, with meaning)

| Token | Hex | Role |
|-------|-----|------|
| Bone | `#ECE7DA` | canvas / paper |
| Ink | `#141210` | type, rules, the structural near-black |
| Ultramarine | `#1D3DF0` | **structure & brand & data** (charts, links, written notes) |
| Flux orange | `#FF5B1F` | **energy only** — the live note, the cursor, the VU peak, feedback |

Keeping orange exclusively for "live/feedback" is what stops it reading as a
generic two-tone theme: the eye learns *orange = the thing happening now*.

### Type

- **Display:** Archivo (800/900) — heavy, slightly condensed, set huge with tight tracking.
- **Data / captions:** DM Mono — every label, metric, meta line, and code-like value.

## Screens

**Landing** (`landing.html`)
Hero → 01 The problem (why guitarists stall at the page) → 02 How it works
(read a fresh line · play & get scored · see the results) → 03 The proof
(accuracy trend + weak-spot heatmap) → Download (email gate) → FAQ → footer.

**App** (`app.html`)
1. **Onboarding** — mic check (VU), pick key/position/daily-goal, headphone tip.
2. **Practice** — the core loop: étude on a "take" panel, flux current-note +
   cursor, transport, VU + live accuracy, studio-style status bar.
3. **Results** — big pitch/timing numbers, hit/wrong/late/missed/extra chips,
   note-by-note table, pitch-vs-time graph, retry actions, hear-the-take-back.
4. **Progress** — totals, accuracy trend, practice calendar/streak, weak-spot
   heatmap (note × position).

## Market-test mechanics (email-gated download)

1. Primary CTA = **enter email → "link sent" → download from GitHub Releases.**
   Email is the demand signal; a secondary "Releases ↗" link is the no-friction path.
2. The mockup form runs the real enter→sent state transition (vanilla JS, no backend)
   so the UX reads true.
3. **Live build:** host on **Vercel**; the form POSTs to a small **Next.js** route
   (pseudo-backend) that stores the email and returns/sends the release link.

## Notes

- Web fonts load from Google Fonts; system fallbacks apply offline.
- Motion: one orchestrated page-load reveal (staggered), hover micro-interactions,
  animated VU. Respects `prefers-reduced-motion`.
- Responsive down to ~mobile widths.

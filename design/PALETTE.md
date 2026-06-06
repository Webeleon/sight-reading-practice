# Sight Reading — "Signal Tape" colour palette

Designer hand-off. These are the exact, shipped design tokens (from
`design/signal-tape.css` / the app + landing). Open `design/palette.html` for a
visual swatch sheet.

**The idea:** record-sleeve austerity (bone paper + ink, oversized type, lots of
whitespace) warmed by analog-studio riso. Two-colour discipline with *meaning*:
**ultramarine = structure / brand / data**, **flux orange = energy — the live
note & feedback only.** Keeping orange exclusive to "happening now" is what makes
the system feel intentional rather than generically two-tone.

---

## Core — paper & ink

| Swatch | Hex | Token | Role |
|---|---|---|---|
| Bone | `#ECE7DA` | `--paper` | The canvas. Primary background everywhere. |
| Panel | `#F3EFE4` | `--paper-2` | Lifted surfaces (cards, the staff "sheet"). |
| Inset | `#E2DCCB` | `--paper-3` | Sunken/recessed areas, title strips, dev drawer. |
| Ink | `#141210` | `--ink` | Near-black. Display type, rules, borders, default notehead. |
| Ink soft | `#4A463F` | `--ink-2` | Secondary text (body/meta). |
| Ink faded | `#8A8478` | `--ink-3` | De-emphasised captions / labels (low-contrast by design). |
| Hairline | `#CFC8B6` | `--line` | 1px rules, dividers, table borders. |

## Accents

| Swatch | Hex | Token | Role |
|---|---|---|---|
| Ultramarine | `#1D3DF0` | `--blue` | **Structure / brand / data.** Accent rules, links, charts, "correct". |
| Ultramarine deep | `#142BB0` | `--blue-d` | Hover / pressed / focus state of ultramarine. |
| Flux orange | `#FF5B1F` | `--flux` | **Energy / live / feedback only.** Fills, the current note, VU peak, tape labels. Pair with white **or** ink as large/bold text — see contrast. |
| Flux ink | `#B23A12` | `--flux-ink` | Darker flux for **flux-coloured TEXT on bone** (AA-safe). Use this, not `--flux`, whenever orange is the text colour. |

## Semantic — sight-reading feedback

The note-by-note + staff feedback colours. (Hit reuses ultramarine, wrong reuses
flux — so the two-colour system carries the meaning.)

| Meaning | Hex | Token | Notes |
|---|---|---|---|
| Correct / hit | `#1D3DF0` | `--blue` | Right pitch, in time. |
| Wrong pitch | `#FF5B1F` | `--flux` | Right time, wrong pitch. |
| Late (timing) | `#C2823A` | `--warn` | Right pitch, off the beat (amber). |
| Missed | `#8A8478` | `--ink-3` | Nothing detected — faded. |
| In-tune / success | `#1F8F5B` | `--ok` | Positive confirmations; use sparingly. |
| Extra note | `#1D3DF0` (outline) | — | Ultramarine outline on transparent (not a fill). |

## Data-viz heat ramp (progress "weak-spots")

Green → amber → flux, clean to often-missed:

`#1F8F5B` · `#3A9B63` · `#5A9A57` · `#7A9A4E` · `#C2823A` · `#D96F2C` · `#FF5B1F`

---

## Contrast / accessibility (text on Bone `#ECE7DA`)

| Foreground | Ratio | Verdict |
|---|---|---|
| Ink `#141210` | ~15.3:1 | AAA — body & display |
| Ink soft `#4A463F` | ~7.3:1 | AA — secondary text |
| Ultramarine `#1D3DF0` | ~5.5:1 | AA — links, data, normal text |
| Flux ink `#B23A12` | ~4.6:1 | AA — use for orange text |
| Ink faded `#8A8478` | ~3.0:1 | Large / de-emphasised captions only |
| Flux `#FF5B1F` | ~2.4:1 | ✗ Fails — **never use as text on bone** (use `--flux-ink`) |

**On flux fills `#FF5B1F`:** ink text ≈ 6.3:1 (AA ✓); white text ≈ 3:1 (large/bold
display only — e.g. the hero "wall." block). For normal-size text on flux, use ink.

**On ink `#141210`:** bone / panel / white all pass comfortably; ultramarine and
flux read well as accents.

---

## Type (for completeness)

- **Display:** **Archivo** (800/900) — heavy, slightly condensed, set large with
  tight tracking (`letter-spacing: -0.03em` to `-0.045em`).
- **Data / labels / captions:** **DM Mono** (400/500) — every metric, meta line,
  and code-like value; uppercase + `letter-spacing` for small labels.

## Texture & motif (so the palette reads "Signal Tape")

- Subtle **paper grain** (monochrome noise, ~30% multiply) over the bone canvas.
- **Halftone dot-screen** in ultramarine (or flux) at ~10% as a structural texture.
- **Crop-marks** (corner ticks) and rotated **tape labels** in flux as recurring
  print/record-sleeve details.

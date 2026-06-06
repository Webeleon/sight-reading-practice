import { ImageResponse } from "next/og";

/*
 * Auto-wired OG / Twitter card image (1200x630). Next injects absolute
 * <meta property="og:image"> and <meta name="twitter:image"> tags resolved
 * against metadataBase, so summary_large_image now renders a real card.
 *
 * Rendered with the "Signal Tape" palette from app/globals.css — bone paper,
 * near-black ink, ultramarine structure, flux-orange energy — using system
 * fonts to stay dependency-free.
 */

export const alt =
  "Sight Reading — a sight-reading gym for guitarists. Reading music shouldn't feel like a wall.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Palette (mirrors :root tokens in globals.css)
const PAPER = "#ECE7DA";
const INK = "#141210";
const INK_3 = "#8A8478";
const BLUE = "#1D3DF0";
const FLUX = "#FF5B1F";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: "64px 72px",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* crop-marks — the recurring print / record-sleeve motif */}
        <div
          style={{
            position: "absolute",
            left: 28,
            top: 28,
            width: 22,
            height: 22,
            borderLeft: `3px solid ${INK}`,
            borderTop: `3px solid ${INK}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 28,
            bottom: 28,
            width: 22,
            height: 22,
            borderRight: `3px solid ${INK}`,
            borderBottom: `3px solid ${INK}`,
          }}
        />

        {/* top row: brand + eyebrow */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 22,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: INK,
            fontFamily: "monospace",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            SIGHT READING
            {/* registration mark ✛, drawn so it needs no dynamic font fetch */}
            <RegMark />
          </div>
          <div style={{ color: INK_3, fontSize: 18 }}>EST. 2026</div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              fontSize: 92,
              fontWeight: 900,
              lineHeight: 1.0,
              letterSpacing: "-0.03em",
            }}
          >
            <span>Reading music shouldn&apos;t feel like a&nbsp;</span>
            <span style={{ background: FLUX, color: "#fff", padding: "0 8px" }}>
              wall.
            </span>
          </div>
          <div
            style={{
              fontSize: 28,
              color: INK,
              maxWidth: 900,
              fontFamily: "monospace",
              lineHeight: 1.4,
            }}
          >
            A sight-reading gym for guitarists — a fresh line every day, instant
            note-by-note feedback, and proof you&apos;re getting better.
          </div>
        </div>

        {/* bottom row: footer rule */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `3px solid ${INK}`,
            paddingTop: 22,
            fontFamily: "monospace",
            fontSize: 20,
            letterSpacing: "0.06em",
          }}
        >
          <div style={{ color: INK_3 }}>TEST PRESSING · BY WEBELEON</div>
          <div style={{ display: "flex", alignItems: "center", color: BLUE }}>
            DOWNLOAD THE FREE PROTOTYPE
            <DownArrow />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

/**
 * Registration mark (✛) drawn from two bars so the image needs no dynamic font
 * fetch for the glyph (Satori's default font lacks it and tries to download one).
 */
function RegMark() {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: 18,
        height: 18,
        marginLeft: 12,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 8,
          top: 0,
          width: 2,
          height: 18,
          background: BLUE,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 8,
          width: 18,
          height: 2,
          background: BLUE,
        }}
      />
    </div>
  );
}

/** Down arrow drawn as a triangle (avoids a dynamic font fetch for ↓). */
function DownArrow() {
  return (
    <div
      style={{
        marginLeft: 12,
        width: 0,
        height: 0,
        borderLeft: "9px solid transparent",
        borderRight: "9px solid transparent",
        borderTop: `12px solid ${BLUE}`,
      }}
    />
  );
}

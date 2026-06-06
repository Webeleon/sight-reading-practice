import styles from "./Proof.module.css";

/** Weak-spot heatmap data — note × fretboard position, with the exact
 *  per-cell colours from the mockup preserved. */
const HEAT_ROWS: { label: string; cells: { score: number; bg: string }[] }[] = [
  {
    label: "pos 5",
    cells: [
      { score: 98, bg: "#1f8f5b" },
      { score: 94, bg: "#3a9b63" },
      { score: 86, bg: "#7a9a4e" },
      { score: 61, bg: "#FF5B1F" },
      { score: 93, bg: "#3a9b63" },
      { score: 97, bg: "#1f8f5b" },
    ],
  },
  {
    label: "pos 7",
    cells: [
      { score: 90, bg: "#5a9a57" },
      { score: 74, bg: "#c2823a" },
      { score: 96, bg: "#1f8f5b" },
      { score: 68, bg: "#d96f2c" },
      { score: 85, bg: "#7a9a4e" },
      { score: 92, bg: "#3a9b63" },
    ],
  },
];

export function Proof() {
  return (
    <section className="section sec" id="proof">
      <div className="sec-id">
        <span className="num">03</span>
        <span className="lbl">The proof</span>
      </div>
      <h2>See the results.</h2>
      <p className="body">
        Every take is saved, so the question stops being &quot;do I feel better
        at this?&quot; and becomes &quot;is the line going up?&quot; Here&apos;s
        what that looks like.
      </p>
      <div className={styles.dash}>
        <div className={`${styles.panel} reveal d1`}>
          <div className={styles.h}>
            <span>Pitch accuracy · last 30 days</span>
            <span className="u-blue">+37 pts</span>
          </div>
          <svg
            className={styles.trend}
            viewBox="0 0 520 200"
            aria-label="accuracy trend"
          >
            <g stroke="#CFC8B6" strokeWidth="1">
              <line x1="34" y1="20" x2="510" y2="20" />
              <line x1="34" y1="65" x2="510" y2="65" />
              <line x1="34" y1="110" x2="510" y2="110" />
              <line x1="34" y1="155" x2="510" y2="155" />
            </g>
            <g fill="#8A8478" fontFamily="DM Mono, monospace" fontSize="9">
              <text x="6" y="24">
                100
              </text>
              <text x="14" y="114">
                70
              </text>
              <text x="14" y="159">
                50
              </text>
            </g>
            <polygon
              fill="#1D3DF0"
              opacity="0.08"
              points="34,150 90,140 146,144 202,120 258,112 314,92 370,84 426,58 482,40 482,170 34,170"
            />
            <polyline
              fill="none"
              stroke="#1D3DF0"
              strokeWidth="2.5"
              points="34,150 90,140 146,144 202,120 258,112 314,92 370,84 426,58 482,40"
            />
            <circle cx="482" cy="40" r="4" fill="#FF5B1F" />
            <text
              x="442"
              y="32"
              fill="#FF5B1F"
              fontFamily="DM Mono, monospace"
              fontSize="10"
            >
              91%
            </text>
          </svg>
        </div>
        <div className={`${styles.panel} reveal d2`}>
          <div className={styles.h}>
            <span>Weak spots · by note</span>
            <span className="u-blue">drills here</span>
          </div>
          <div className={styles.heat}>
            <span className={styles.hd}></span>
            <span className={styles.hd}>C</span>
            <span className={styles.hd}>D</span>
            <span className={styles.hd}>E</span>
            <span className={styles.hd}>F♯</span>
            <span className={styles.hd}>G</span>
            <span className={styles.hd}>A</span>
            {HEAT_ROWS.map((row) => (
              <Row key={row.label} label={row.label} cells={row.cells} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  cells,
}: {
  label: string;
  cells: { score: number; bg: string }[];
}) {
  return (
    <>
      <span className={styles.lab}>{label}</span>
      {cells.map((cell, i) => (
        <span
          key={`${label}-${i}`}
          className={styles.c}
          style={{ background: cell.bg }}
        >
          {cell.score}
        </span>
      ))}
    </>
  );
}

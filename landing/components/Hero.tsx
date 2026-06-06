import { EmailGate } from "./EmailGate";
import { ProofStrip } from "./ProofStrip";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <header className={`section ${styles.hero} pos`}>
      <p className={`${styles.kick} reveal d1`}>
        <span className="reg">✛</span> A sight-reading gym for guitarists ·{" "}
        <span className="mono">EST. 2026</span>
      </p>
      <h1 className="reveal d2">
        Reading music shouldn&apos;t feel like a{" "}
        <span className="u-flux">wall.</span>
      </h1>

      <div className={styles.grid}>
        <p className={`${styles.lede} reveal d3`}>
          You already play. But the dots on the page still freeze you — so you
          fall back to tab and the wall stays up.{" "}
          <b>This turns reading into a five-minute daily habit:</b>{" "}
          a fresh line every day, instant note-by-note feedback, and proof
          you&apos;re
          actually getting better.
        </p>

        <div className="reveal d4">
          <EmailGate variant="light" />
        </div>
      </div>

      <div className="reveal d5">
        <ProofStrip />
      </div>

      <div className="tex-half" />
    </header>
  );
}

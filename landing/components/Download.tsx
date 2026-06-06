import { EmailGate } from "./EmailGate";
import styles from "./Download.module.css";

export function Download() {
  return (
    <section className={`${styles.download} pos`} id="get">
      <div className={styles.texHalf} />
      <div className={styles.inner}>
        <p className={`eyebrow ${styles.eyebrow}`}>Download the prototype</p>
        <h2>
          Try it on your <span className={styles.u}>own guitar.</span>
        </h2>
        <div className={styles.grid}>
          <p className={styles.lede}>
            The prototype is free and runs on your machine. Drop your email and
            we&apos;ll send a download link — that&apos;s how we know which
            guitarists to build the full thing for. Prefer no email? The builds
            are on GitHub Releases.
          </p>
          <EmailGate variant="dark" />
        </div>
      </div>
    </section>
  );
}

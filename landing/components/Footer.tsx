import styles from "./Footer.module.css";

export function Footer() {
  return (
    <footer className={`${styles.footer} pos tex-grain`}>
      <div className={`${styles.row} z`}>
        <span className={styles.brand}>Sight Reading ✛</span>
        <span className={styles.stamp}>TEST PRESSING · 2026</span>
        <span className={styles.meta}>
          Built by webeleon ·{" "}
          <a href="#get" style={{ color: "var(--blue)" }}>
            GitHub ↗
          </a>{" "}
          · © 2026
        </span>
      </div>
    </footer>
  );
}

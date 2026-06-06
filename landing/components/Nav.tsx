import styles from "./Nav.module.css";

export function Nav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.row}>
        <span className={styles.brand}>
          Sight Reading <span className={`reg ${styles.reg}`}>✛</span>
        </span>
        <span className={styles.links}>
          <a href="#problem">The problem</a>
          <a href="#how">How it works</a>
          <a href="#proof">The proof</a>
          <a href="#get">Download</a>
        </span>
        <a className={styles.gh} href="#get">
          GitHub ↗
        </a>
      </div>
    </nav>
  );
}

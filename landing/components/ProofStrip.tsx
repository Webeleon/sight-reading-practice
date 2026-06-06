import styles from "./ProofStrip.module.css";

export function ProofStrip() {
  return (
    <div className={styles.proof}>
      <div className={styles.cell}>
        <div className={styles.k}>A reader&apos;s first 6 weeks</div>
        <div className={styles.n}>
          54% <span className={styles.arr}>→</span> 91%
        </div>
      </div>
      <div className={styles.cell}>
        <div className={styles.k}>Lines read</div>
        <div className={styles.n}>312</div>
      </div>
      <div className={styles.cell}>
        <div className={styles.k}>Day streak</div>
        <div className={styles.n}>
          18
          <svg
            width="118"
            height="20"
            viewBox="0 0 118 20"
            style={{
              display: "inline-block",
              verticalAlign: "middle",
              marginLeft: "8px",
            }}
          >
            <polyline
              fill="none"
              stroke="#1D3DF0"
              strokeWidth="2"
              points="0,16 14,14 28,15 42,10 56,11 70,7 84,8 98,4 118,3"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

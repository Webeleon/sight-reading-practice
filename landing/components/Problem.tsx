import styles from "./Problem.module.css";

export function Problem() {
  return (
    <section className="section sec" id="problem">
      <div className="sec-id">
        <span className="num">01</span>
        <span className="lbl">The problem</span>
      </div>
      <h2>Tab got you this far. The page is where you stall.</h2>
      <p className="body">
        Sight-reading is the skill every guitarist is told to build and almost
        nobody practices — because the usual options are a paper method book with
        no feedback, or an app that wasn&apos;t built for the fretboard. So you
        guess, you lose your place, and you quietly give up.
      </p>
      <div className={styles.pains}>
        <div className={styles.pain}>
          <div className={styles.q}>No feedback</div>
          <p>
            Paper can&apos;t tell you the note was a half-step flat or a beat
            late. You repeat mistakes without knowing.
          </p>
        </div>
        <div className={styles.pain}>
          <div className={styles.q}>No fresh material</div>
          <p>
            You memorise the same ten exercises. Reading becomes recall — the
            opposite of sight-reading.
          </p>
        </div>
        <div className={styles.pain}>
          <div className={styles.q}>No proof</div>
          <p>
            Without numbers, you can&apos;t tell a good week from a bad one.
            Progress feels invisible, so motivation dies.
          </p>
        </div>
      </div>
    </section>
  );
}

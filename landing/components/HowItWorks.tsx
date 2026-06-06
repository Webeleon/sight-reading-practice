import styles from "./HowItWorks.module.css";

export function HowItWorks() {
  return (
    <section className="section sec" id="how">
      <div className="sec-id">
        <span className="num">02</span>
        <span className="lbl">How it works</span>
      </div>
      <h2>Practice it until it isn&apos;t hard.</h2>
      <p className="body">
        Three moves, five minutes, every day. The app generates the music,
        listens to your guitar, and keeps score.
      </p>
      <div className={styles.steps}>
        <div className={`${styles.step} reveal d1`}>
          <span className={styles.tag}>★ generated daily</span>
          <div className={styles.no}>01</div>
          <h3>Read a fresh line</h3>
          <p>
            A new etude every time — in the key and fretboard position
            you&apos;re working on. Never memorised, always read.
          </p>
        </div>
        <div className={`${styles.step} reveal d2`}>
          <div className={styles.no}>02</div>
          <h3>Play it. Get scored.</h3>
          <p>
            A count-in, a metronome, and pitch detection that catches every note
            — right, wrong, late, or missed — in real time as you play.
          </p>
        </div>
        <div className={`${styles.step} reveal d3`}>
          <div className={styles.no}>
            <span className={styles.pct}>%</span>
          </div>
          <h3>See the results add up</h3>
          <p>
            Pitch and timing accuracy, your weak notes, your streak. The wall
            turns into a graph that goes up.
          </p>
        </div>
      </div>
    </section>
  );
}

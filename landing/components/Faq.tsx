import styles from "./Faq.module.css";

const QUESTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is it free?",
    a: "Yes — the prototype is free to download and use. We're validating whether guitarists want this before building the full native app.",
  },
  {
    q: "Why ask for my email?",
    a: "It's the whole point of the test: it tells us how many players actually want this, and lets us send you the next build. We won't sell it or spam you.",
  },
  {
    q: "Do I need special gear?",
    a: "Just your guitar and your computer's mic (an audio interface is better). Headphones recommended so the metronome doesn't bleed into detection.",
  },
  {
    q: 'How early is "early"?',
    a: "Very. It's a working prototype to prove the idea — rough edges included. Your feedback shapes what the real version becomes.",
  },
];

export function Faq() {
  return (
    <section className="section sec" id="faq">
      <div className="sec-id">
        <span className="num">04</span>
        <span className="lbl">Questions</span>
      </div>
      <h2>The short version.</h2>
      <div className={styles.faq}>
        {QUESTIONS.map((item) => (
          <div className={styles.qa} key={item.q}>
            <h4>{item.q}</h4>
            <p>{item.a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

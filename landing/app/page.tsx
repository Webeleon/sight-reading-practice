import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Problem } from "@/components/Problem";
import { HowItWorks } from "@/components/HowItWorks";
import { Proof } from "@/components/Proof";
import { Download } from "@/components/Download";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <hr className="rule-h" />
        <HowItWorks />
        <hr className="rule-h" />
        <Proof />
        <Download />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";
import { BrandMark } from "@/components/BrandMark";

const GITHUB_URL = "https://github.com/lmoheyma/clip-decoder";

const STEPS = [
  { step: "01", tool: "ingest",    desc: "Pulls the clip at 480p plus auto-captions if available." },
  { step: "02", tool: "shots",     desc: "Cuts on shot boundaries; one keyframe per shot, capped at 80." },
  { step: "03", tool: "vision",    desc: "Composition, palette, camera, costume — evidence only." },
  { step: "04", tool: "cross-ref", desc: "Names the works the frames may be quoting." },
  { step: "05", tool: "verify",    desc: "Adversarial pass + Wikipedia confirmation." },
];

function Slate() {
  return (
    <div className="slate">
      <BrandMark />
      <b>ClipDecoder</b>
      <span className="sep" />
      <a className="slate-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
        GitHub ↗
      </a>
    </div>
  );
}

function Stage({ onSubmit }: { onSubmit: (id: string) => void }) {
  return (
    <section className="home-stage">
      <h1 className="home-h1">
        <span className="reveal" style={{ animationDelay: "60ms" }}>Every</span>
        {" "}
        <span className="reveal" style={{ animationDelay: "140ms" }}>shot</span>
        <br />
        <span className="reveal" style={{ animationDelay: "220ms" }}>is</span>
        {" "}
        <span className="reveal" style={{ animationDelay: "300ms" }}>a</span>
        {" "}
        <em className="home-h1-em reveal" style={{ animationDelay: "380ms" }}>
          quotation.
        </em>
        <span className="home-h1-sub reveal" style={{ animationDelay: "560ms" }}>
          We name the source.
        </span>
      </h1>

      <div className="home-form-row reveal" style={{ animationDelay: "780ms" }}>
        <HeroForm onSubmit={(r) => onSubmit(r.youtube_id)} />
      </div>
    </section>
  );
}

function PipelineStrip() {
  return (
    <footer className="pipeline-strip">
      {STEPS.map((s) => (
        <div key={s.step} className="pipeline-strip-step">
          <span className="num">{s.step}</span>
          <span className="tool">{s.tool}</span>
          <span className="desc">{s.desc}</span>
        </div>
      ))}
    </footer>
  );
}

export default function Home() {
  const router = useRouter();
  return (
    <main className="frame surface-dark home-root">
      <div aria-hidden className="aurora" />
      <div aria-hidden className="aurora aurora-b" />
      <div aria-hidden className="grain" />

      <div className="home-shell">
        <Slate />
        <Stage onSubmit={(id) => router.push(`/report/${id}`)} />
        <PipelineStrip />
      </div>
    </main>
  );
}

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

const SLATE_LINK =
  "no-underline font-sans not-italic font-medium text-[15px] text-body transition-colors duration-200 hover:text-ink";

function Slate() {
  return (
    <div className="slate relative z-[2] flex items-center gap-[18px] px-[clamp(28px,4vw,56px)] py-[22px] max-sm:px-5 max-sm:py-[14px] max-sm:gap-3 font-sans text-sm text-body tracking-[0.14px]">
      <BrandMark />
      <b className="font-serif not-italic font-normal text-[22px] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'SOFT'_100]">
        ClipDecoder
      </b>
      <span className="flex-1 h-px" />
      <a className={SLATE_LINK} href={GITHUB_URL} target="_blank" rel="noreferrer">
        GitHub ↗
      </a>
    </div>
  );
}

function Stage({ onSubmit }: { onSubmit: (id: string) => void }) {
  return (
    <section className="flex-1 w-full max-w-[1240px] mx-auto flex flex-col justify-center items-center text-center gap-8 py-[clamp(24px,4vh,56px)] px-[clamp(24px,3vw,48px)] max-[820px]:gap-6 max-[820px]:py-4 max-[720px]:gap-[18px] max-[640px]:gap-3.5">
      <h1 className="m-0 font-serif font-light text-ink leading-[0.96] tracking-[-0.028em] text-[clamp(56px,8.4vw,132px)] max-[720px]:text-[clamp(48px,7vw,96px)] [font-variation-settings:'SOFT'_100]">
        <span className="inline-block reveal" style={{ animationDelay: "60ms" }}>Every</span>
        {" "}
        <span className="inline-block reveal" style={{ animationDelay: "140ms" }}>shot</span>
        <br />
        <span className="inline-block reveal" style={{ animationDelay: "220ms" }}>is</span>
        {" "}
        <span className="inline-block reveal" style={{ animationDelay: "300ms" }}>a</span>
        {" "}
        <em className="italic font-normal text-grad-lavender reveal [font-variation-settings:'SOFT'_100]" style={{ animationDelay: "380ms" }}>
          quotation.
        </em>
        <span className="block not-italic font-light font-serif text-body mt-11 max-[720px]:mt-3.5 tracking-[-0.005em] text-[0.28em] [font-variation-settings:'SOFT'_50] reveal" style={{ animationDelay: "560ms" }}>
          We name the source.
        </span>
      </h1>

      <div className="mt-1 self-stretch flex justify-center min-w-0 reveal" style={{ animationDelay: "780ms" }}>
        <div className="w-full max-w-[560px] mx-auto min-w-0">
          <HeroForm onSubmit={(r) => onSubmit(r.youtube_id)} />
        </div>
      </div>
    </section>
  );
}

function PipelineStrip() {
  return (
    <footer className="grid grid-cols-5 gap-0 px-[clamp(32px,5vw,64px)] pt-[18px] pb-[22px] mb-6 bg-transparent opacity-0 animate-[meta-in_0.7s_ease-out_1.1s_forwards] max-[820px]:pt-[14px] max-[820px]:pb-4 max-[640px]:py-2.5 max-[768px]:grid-cols-2 max-[768px]:gap-y-3 max-[768px]:px-6 max-[768px]:py-4">
      {STEPS.map((s, i) => (
        <div
          key={s.step}
          className={`flex flex-col gap-1 px-4 border-l border-hairline-soft first:border-l-0 first:pl-0 last:pr-0 max-[768px]:px-3 ${i % 2 === 0 ? "max-[768px]:border-l-0 max-[768px]:pl-0" : ""}`}
        >
          <span className="font-mono text-[10px] tracking-[0.14em] text-muted">{s.step}</span>
          <span className="font-serif italic font-normal leading-[1.1] tracking-[-0.01em] text-body-strong text-[17px] max-[640px]:text-sm max-[768px]:text-sm [font-variation-settings:'SOFT'_80]">{s.tool}</span>
          <span className="font-sans text-[11.5px] leading-[1.5] text-muted tracking-[0.1px] mt-0.5 max-[720px]:hidden max-[768px]:hidden">{s.desc}</span>
        </div>
      ))}
    </footer>
  );
}

export default function Home() {
  const router = useRouter();
  return (
    <main className="relative overflow-hidden bg-canvas text-ink min-h-screen min-h-[100dvh] flex flex-col">
      <div aria-hidden className="aurora" />
      <div aria-hidden className="aurora aurora-b" />
      <div aria-hidden className="grain" />

      <div className="relative z-[2] flex flex-col flex-1 min-h-0">
        <Slate />
        <Stage onSubmit={(id) => router.push(`/report/${id}`)} />
        <PipelineStrip />
      </div>
    </main>
  );
}

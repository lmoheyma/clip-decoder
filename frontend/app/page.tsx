"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";

const RECENT_QUOTATIONS_DEMO = [
  { time: "00:42", verdict: "confirmed" as const,   title: "Le faux miroir",                creator: "René Magritte",    year: 1929, type: "Painting" },
  { time: "01:18", verdict: "confirmed" as const,   title: "The Calling of Saint Matthew", creator: "Caravaggio",       year: 1600, type: "Painting" },
  { time: "02:04", verdict: "speculative" as const, title: "Stalker",                      creator: "Andrei Tarkovsky", year: 1979, type: "Film"     },
  { time: "02:51", verdict: "confirmed" as const,   title: "Meshes of the Afternoon",      creator: "Maya Deren",       year: 1943, type: "Film"     },
];
// TODO(SP6): replace RECENT_QUOTATIONS_DEMO with dynamic GET /api/recent-references
// once the endpoint exists. Until then, this is curated demo content.

const STEPS = [
  { step: "01 — ingest",    tool: "yt-dlp",             desc: "Pulls the clip at 480p plus auto-captions if available." },
  { step: "02 — shots",     tool: "PySceneDetect",      desc: "Cuts on shot boundaries; one keyframe per shot, capped at 80." },
  { step: "03 — vision",    tool: "Nemotron Nano VL",   desc: "Composition, palette, camera, costume — evidence only." },
  { step: "04 — cross-ref", tool: "Llama 3.x",          desc: "Names the works the frames may be quoting." },
  { step: "05 — verify",    tool: "Adversarial + Wiki", desc: "A second pass defends each claim. Wikipedia confirms it exists." },
];

function Slate() {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10).replaceAll("-", "·"));
  }, []);
  return (
    <div className="slate">
      <span className="dot" />
      <b>ClipDecoder</b>
      <span className="slate-version">v0.1 · local-first · NIM</span>
      <span className="sep" />
      <span className="tc slate-scene">scene 01 · take 01</span>
      <span className="tc">{today || " "}</span>
      <span className="tc slate-timecode">00:00:00:00</span>
      <span className="sep" />
      <span className="slate-docs">Docs</span>
      <span className="slate-github">GitHub ↗</span>
    </div>
  );
}

function Stage({ onSubmit }: { onSubmit: (id: string) => void }) {
  return (
    <section
      className="relative grid gap-12 lg:grid-cols-[1fr_400px]"
      style={{ paddingLeft: "clamp(32px, 5vw, 64px)", paddingRight: "clamp(32px, 5vw, 64px)", paddingTop: 48, paddingBottom: 48 }}
    >
      {/* Left column — hero */}
      <div>
        <div className="hairline" style={{ marginBottom: 18 }}>
          A local tool · NIM · Wikipedia-verified
        </div>
        <h1
          className="serif-it"
          style={{
            fontSize: "clamp(72px, 9vw, 144px)",
            lineHeight: 0.96,
            margin: 0,
          }}
        >
          Every shot
          <br />
          is a{" "}
          <em style={{ color: "var(--grad-lavender)", fontStyle: "italic" }}>
            quotation.
          </em>
          <span
            style={{
              display: "block",
              fontSize: "0.36em",
              marginTop: 24,
              color: "var(--body)",
              fontStyle: "normal",
            }}
          >
            We name the source.
          </span>
        </h1>

        <p
          style={{
            maxWidth: 640,
            marginTop: 32,
            fontSize: 18,
            lineHeight: 1.5,
            color: "var(--body)",
            letterSpacing: 0.18,
          }}
        >
          Paste a music video. ClipDecoder splits it into shots, asks a vision
          model what it sees, then cross-references each frame against a library
          of films, paintings, photographs, and other clips — returning
          evidence-grounded candidates the artist may be quoting.
        </p>

        <div style={{ marginTop: 32 }}>
          <HeroForm onSubmit={(r) => onSubmit(r.youtube_id)} />
        </div>

        <div
          style={{
            marginTop: 20,
            display: "flex",
            flexWrap: "wrap",
            gap: 24,
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--body)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="kbd">⌘ V</span> paste from clipboard
          </span>
          <span>YouTube only · 480p · ~90s analysis</span>
        </div>
      </div>

      {/* Right column — recent quotations (static demo, see TODO) */}
      <aside>
        <div className="hairline" style={{ marginBottom: 10, paddingLeft: 4 }}>
          Recent quotations we've found
        </div>
        <div className="cite-stack">
          {RECENT_QUOTATIONS_DEMO.map((q) => (
            <button
              key={`${q.time}-${q.title}`}
              type="button"
              disabled
              aria-disabled="true"
              className={`cite-card cite-card-disabled${q.verdict === "speculative" ? " cite-card-speculative" : ""}`}
            >
              <div
                style={
                  q.verdict === "speculative"
                    ? { color: "var(--grad-sky)", fontSize: 13, letterSpacing: 0.13 }
                    : { color: "var(--muted)", fontSize: 13, letterSpacing: 0.13 }
                }
              >
                {q.time} · {q.verdict}
              </div>
              <h4>{q.title}</h4>
              <div style={{ fontSize: 13, color: "var(--body)", letterSpacing: 0.13 }}>
                {q.creator} · {q.year} · {q.type}
              </div>
              <span className="arrow">↗</span>
            </button>
          ))}
        </div>
      </aside>
    </section>
  );
}

function FooterStrip() {
  return (
    <footer className="footer-strip">
      {STEPS.map((s) => (
        <div key={s.step}>
          <span className="step">{s.step}</span>
          <span className="num">{s.tool}</span>
          <span className="desc">{s.desc}</span>
        </div>
      ))}
    </footer>
  );
}

export default function Home() {
  const router = useRouter();
  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      {/* Ambient orbs — only "voltage" of the new design */}
      <div
        aria-hidden
        className="orb peach"
        style={{ top: -120, right: -80, width: 480, height: 480 }}
      />
      <div
        aria-hidden
        className="orb lavender"
        style={{ bottom: -160, left: -100, width: 560, height: 560, animationDelay: "-12s" }}
      />
      <div
        aria-hidden
        className="orb mint"
        style={{ top: "40%", left: "30%", width: 320, height: 320, opacity: 0.35, animationDelay: "-26s" }}
      />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>
        <Slate />
        <div style={{ flex: 1 }}>
          <Stage onSubmit={(id) => router.push(`/report/${id}`)} />
        </div>
        <FooterStrip />
      </div>
    </main>
  );
}

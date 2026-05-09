"use client";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";

const STATS: { value: string; label: string }[] = [
  { value: "≈ 80", label: "shots / video" },
  { value: "12+", label: "reference types surfaced" },
  { value: "0¢", label: "stored on our side" },
];

const SUPPORTED: string[] = [
  "FILMS",
  "MUSIC VIDEOS",
  "PAINTINGS",
  "PHOTOGRAPHS",
  "ARCHIVAL FOOTAGE",
  "ALBUM ART",
  "AD CAMPAIGNS",
  "FASHION EDITORIALS",
];

export default function Home() {
  const router = useRouter();
  return (
    <main className="relative min-h-screen flex flex-col bg-dawn-cloud overflow-hidden">
      {/* Decorative aurora orb — pure illustration, brand colors allowed */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 w-[640px] h-[640px] rounded-full float-slow"
        style={{
          background:
            "radial-gradient(closest-side, rgba(239,44,193,0.55), rgba(189,187,255,0.35) 45%, rgba(252,76,2,0.25) 70%, transparent 80%)",
          filter: "blur(28px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 bottom-10 w-[480px] h-[480px] rounded-full float-slow"
        style={{
          background:
            "radial-gradient(closest-side, rgba(189,187,255,0.55), rgba(239,44,193,0.18) 50%, transparent 75%)",
          filter: "blur(22px)",
          animationDelay: "-6s",
        }}
      />

      {/* ─── Top nav ─────────────────────────────────────────────── */}
      <nav className="relative z-10 px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="block w-2.5 h-2.5 rounded-full bg-midnight" />
          <span className="font-mono uppercase text-[12px] tracking-mono-label">
            ClipDecoder
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 font-mono uppercase text-[11px] tracking-mono-label text-black/60">
          <span>v0.1 · evidence-first</span>
          <span className="inline-flex items-center gap-2">
            <span className="block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            backend live
          </span>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section className="relative z-10 flex-1 px-8 pt-10 md:pt-20 pb-32 max-w-[1240px] w-full mx-auto reveal">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-9">
            <p
              className="reveal-child font-mono uppercase text-[11px] tracking-mono-label text-black/55 mb-8"
              style={{ ["--d" as never]: "60ms" }}
            >
              ⟢ A vision pipeline for visual literacy
            </p>

            <h1
              className="reveal-child font-display tracking-display leading-[0.95] text-[12vw] md:text-[104px]"
              style={{ ["--d" as never]: "140ms" }}
            >
              Decode the
              <br />
              <span className="text-aurora italic font-light mr-[0.18em]">visual</span>
              references
              <br />
              in any clip.
            </h1>

            <p
              className="reveal-child mt-8 max-w-[640px] text-[18px] leading-[1.4] tracking-body text-black/70"
              style={{ ["--d" as never]: "260ms" }}
            >
              Paste a YouTube URL. We sample shots, run a vision model on every key
              frame, propose grounded references, then verify each one against the
              frame evidence and Wikipedia. You get an annotated viewer — with
              named films, paintings, photographs, and other clips you can actually
              click through.
            </p>

            <div
              className="reveal-child mt-12"
              style={{ ["--d" as never]: "380ms" }}
            >
              <HeroForm onSubmit={(r) => router.push(`/report/${r.youtube_id}`)} />
            </div>
          </div>

          {/* Stats column */}
          <aside
            className="reveal-child col-span-12 lg:col-span-3 mt-12 lg:mt-0 flex lg:flex-col gap-4"
            style={{ ["--d" as never]: "500ms" }}
          >
            {STATS.map((s, i) => (
              <div
                key={s.label}
                className="flex-1 glass-light rounded-comfy p-5 shadow-midnight"
                style={{ transform: `translateY(${i * 6}px)` }}
              >
                <div className="font-display font-medium tracking-h2 text-[44px] leading-[1]">
                  {s.value}
                </div>
                <div className="mt-2 font-mono uppercase text-[10px] tracking-mono-label text-black/55">
                  {s.label}
                </div>
              </div>
            ))}
          </aside>
        </div>

        {/* Pipeline trace strip */}
        <div
          className="reveal-child mt-20 flex items-center gap-4 font-mono uppercase text-[10px] tracking-mono-label text-black/55"
          style={{ ["--d" as never]: "640ms" }}
        >
          <span className="block w-10 h-px bg-black/15" />
          <span>Ingest</span>
          <span className="text-black/25">→</span>
          <span>Shots</span>
          <span className="text-black/25">→</span>
          <span>Vision</span>
          <span className="text-black/25">→</span>
          <span>Cross-ref</span>
          <span className="text-black/25">→</span>
          <span>Verify</span>
          <span className="block flex-1 h-px bg-gradient-to-r from-black/15 via-[#ef2cc1]/40 to-transparent" />
        </div>
      </section>

      {/* ─── Marquee of supported sources ────────────────────────── */}
      <section className="relative z-10 border-t border-black/10 py-6 overflow-hidden">
        <div className="marquee font-mono uppercase text-[11px] tracking-mono-label text-black/55">
          {[...SUPPORTED, ...SUPPORTED].map((s, i) => (
            <span key={i} className="flex items-center gap-3">
              <span className="block w-1 h-1 rounded-full bg-[#ef2cc1]" />
              {s}
            </span>
          ))}
        </div>
      </section>

      {/* ─── Footer wordmark ─────────────────────────────────────── */}
      <footer className="relative z-10 px-8 pt-24 pb-6 flex flex-col gap-10 overflow-hidden">
        <div className="flex items-end justify-between gap-6">
          <h2 className="wordmark-foot leading-none text-midnight/15">clipdecoder</h2>
          <div className="hidden md:block max-w-[280px] text-[12px] text-black/55 leading-[1.4]">
            Built on NVIDIA NIM endpoints. Frame analyses, reference proposals, and
            verification all run as one pipeline — locally streamed via SSE.
          </div>
        </div>
        <div className="flex items-center justify-between font-mono uppercase text-[10px] tracking-mono-label text-black/45">
          <span>© {new Date().getFullYear()} clipdecoder</span>
          <span>made for visual obsessives</span>
        </div>
      </footer>
    </main>
  );
}

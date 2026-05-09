"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  fetchReport,
  flagReference,
  subscribePipeline,
} from "@/lib/api";
import type {
  PipelineEvent,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { PipelineStatus } from "@/components/PipelineStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { ReferencePanel } from "@/components/ReferencePanel";
import { ConfidenceFilter } from "@/components/ConfidenceFilter";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSpeculative, setShowSpeculative] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);

  useEffect(() => {
    let cancelled = false;
    let close: (() => void) | undefined;

    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) {
        setReport(r);
        return;
      }
      close = subscribePipeline(
        id,
        async (e) => {
          if (cancelled) return;
          setEvents((prev) => [...prev, e]);
          if (e.step === "done") {
            const fresh = await fetchReport(id);
            if (!cancelled) setReport(fresh);
          }
          if (e.step === "error") setError(e.message);
        },
        (err) => !cancelled && setError(String(err)),
      );
    }
    void load();
    return () => {
      cancelled = true;
      close?.();
    };
  }, [id]);

  function jump(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
  }
  async function flag(idx: number) {
    await flagReference(id, idx);
  }

  const stats = useMemo(() => {
    if (!report) return null;
    const confirmed = report.references.filter((r) => r.final_confidence === "confirmed").length;
    const speculative = report.references.filter((r) => r.final_confidence === "speculative").length;
    return {
      confirmed,
      speculative,
      shots: report.frame_analyses.length,
      duration: report.duration_s,
    };
  }, [report]);

  return (
    <main className="relative min-h-screen bg-deep-sky text-white overflow-hidden">
      {/* Decorative aurora glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-10 w-[640px] h-[640px] rounded-full float-slow"
        style={{
          background:
            "radial-gradient(closest-side, rgba(239,44,193,0.30), rgba(189,187,255,0.18) 50%, transparent 80%)",
          filter: "blur(36px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 bottom-0 w-[520px] h-[520px] rounded-full float-slow"
        style={{
          background:
            "radial-gradient(closest-side, rgba(252,76,2,0.25), rgba(189,187,255,0.12) 55%, transparent 80%)",
          filter: "blur(32px)",
          animationDelay: "-8s",
        }}
      />

      {/* ─── Top nav ─────────────────────────────────────────── */}
      <nav className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-white/10">
        <Link href="/" className="flex items-center gap-3 group">
          <span className="block w-2.5 h-2.5 rounded-full bg-lavender" />
          <span className="font-mono uppercase text-[11px] tracking-mono-label group-hover:text-lavender transition-colors">
            ← ClipDecoder
          </span>
        </Link>
        <div className="flex items-center gap-6 font-mono uppercase text-[11px] tracking-mono-label text-white/55">
          <span>Report // {id}</span>
          {report && (
            <ConfidenceFilter
              showSpeculative={showSpeculative}
              onToggle={setShowSpeculative}
            />
          )}
        </div>
      </nav>

      <div className="relative z-10 max-w-[1240px] mx-auto px-8 py-12 reveal">
        {/* Loading state ─ pipeline status takes the whole page */}
        {!report && !error && (
          <div className="reveal-child" style={{ ["--d" as never]: "60ms" }}>
            <PipelineStatus events={events} />
          </div>
        )}

        {error && (
          <div className="reveal-child glass-dark rounded-comfy p-8 max-w-3xl">
            <p className="font-mono uppercase text-[11px] tracking-mono-label text-brand-orange mb-3">
              ⚠ pipeline error
            </p>
            <p className="font-display text-[24px] leading-[1.2] tracking-h3" role="alert">
              {error}
            </p>
            <Link
              href="/"
              className="mt-6 inline-block font-mono uppercase text-[11px] tracking-mono-label text-lavender underline underline-offset-4"
            >
              Try another clip →
            </Link>
          </div>
        )}

        {/* Result state ─ video on left, references on right */}
        {report && (
          <>
            <header
              className="reveal-child mb-10"
              style={{ ["--d" as never]: "60ms" }}
            >
              <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/55 mb-4">
                ⟢ Decoded
              </p>
              <h1 className="font-display tracking-display text-[clamp(40px,6vw,72px)] leading-[1] text-balance max-w-[1000px]">
                {report.title}
              </h1>
              <p className="mt-4 font-mono uppercase text-[11px] tracking-mono-label text-white/55">
                {report.channel} · {Math.floor(report.duration_s / 60)}:
                {String(Math.floor(report.duration_s % 60)).padStart(2, "0")}
              </p>

              {stats && (
                <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat value={stats.confirmed} label="confirmed refs" />
                  <Stat value={stats.speculative} label="speculative refs" />
                  <Stat value={stats.shots} label="frames analyzed" />
                  <Stat
                    value={`${Math.floor(stats.duration / 60)}:${String(Math.floor(stats.duration % 60)).padStart(2, "0")}`}
                    label="duration"
                  />
                </div>
              )}
            </header>

            <div
              className="reveal-child grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8"
              style={{ ["--d" as never]: "180ms" }}
            >
              <div className="flex flex-col gap-4">
                <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
                <p className="font-mono uppercase text-[10px] tracking-mono-label text-white/45">
                  Click any reference card to seek the player
                </p>
              </div>
              <ReferencePanel
                references={report.references}
                showSpeculative={showSpeculative}
                onJump={jump}
                onFlag={flag}
              />
            </div>
          </>
        )}
      </div>

      {/* Footer wordmark ─ massive */}
      <footer className="relative z-10 px-8 pt-32 pb-6 mt-20 border-t border-white/10 overflow-hidden">
        <h2 className="wordmark-foot text-white/20 leading-none">clipdecoder</h2>
        <div className="flex items-center justify-between mt-6 font-mono uppercase text-[10px] tracking-mono-label text-white/35">
          <span>© {new Date().getFullYear()} clipdecoder</span>
          <span>evidence-grounded references · streamed live</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="glass-dark rounded-comfy p-4">
      <div className="font-display tracking-h2 text-[28px] leading-none">{value}</div>
      <div className="mt-2 font-mono uppercase text-[10px] tracking-mono-label text-white/55">
        {label}
      </div>
    </div>
  );
}

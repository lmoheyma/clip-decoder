"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Confidence,
  FrameAnalysis,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { computeReportStats } from "@/lib/reportStats";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { FilterBar } from "@/components/FilterBar";
import { SummaryCard } from "@/components/SummaryCard";
import { ReferenceCard } from "@/components/ReferenceCard";
import { BrandMark } from "@/components/BrandMark";

function formatDuration(s: number): string {
  const t = Math.floor(s);
  return `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toString().padStart(2, "0")}`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "recently";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "recently";
  }
}

export function ReportContent({
  report,
  youtubeId,
}: {
  report: Report;
  youtubeId: string;
}) {
  const [shareToast, setShareToast] = useState(false);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);

  const stats = useMemo(() => computeReportStats(report), [report]);

  const [selectedVerdicts, setSelectedVerdicts] = useState<Set<Confidence>>(
    new Set<Confidence>(["confirmed", "speculative"]),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectedTypes.size === 0 && stats.availableTypes.length > 0) {
      setSelectedTypes(new Set(stats.availableTypes));
    }
  }, [stats, selectedTypes.size]);

  // SP4 — hash-based seek. When the user lands on /report/{id}#t=42.5
  // (typically returning from a reference detail page's JUMP action),
  // seek the embedded player to that timestamp once it has mounted,
  // then clear the hash so a future share/copy of the URL does not
  // re-seek silently.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/^#t=(\d+(?:\.\d+)?)$/);
    if (!m) return;
    const t = Number.parseFloat(m[1]);
    if (Number.isNaN(t)) return;
    const timer = setTimeout(() => {
      playerRef.current?.seekTo(t);
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [report]);

  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    for (const f of report.frame_analyses) m.set(f.frame_id, f);
    return m;
  }, [report]);

  const filteredRefs = useMemo(() => {
    return report.references
      .filter((r) => selectedVerdicts.has(r.final_confidence))
      .filter((r) => selectedTypes.has(r.work_type))
      .sort((a, b) => a.timestamp_s - b.timestamp_s);
  }, [report, selectedVerdicts, selectedTypes]);

  function toggleVerdict(v: Confidence) {
    setSelectedVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }
  function toggleType(t: string) {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function jumpTo(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
    playerContainerRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 2000);
    } catch {
      // clipboard unavailable in non-secure context
    }
  }

  function Slate() {
    return (
      <div className="slate relative z-[2] flex items-center gap-[18px] px-[clamp(28px,4vw,56px)] py-[22px] max-sm:px-5 max-sm:py-[14px] max-sm:gap-3 font-sans text-sm text-body tracking-[0.14px]">
        <BrandMark />
        <b className="font-serif not-italic font-normal text-[22px] leading-none tracking-[-0.015em] text-ink [font-variation-settings:'SOFT'_100]">
          ClipDecoder
        </b>
        <span className="max-sm:hidden font-sans text-[11px] uppercase tracking-[0.14em] text-body pl-[18px] ml-1.5 border-l border-hairline-soft">
          Report
        </span>
        <span className="flex-1 h-px" />
        <a
          className="slate-link"
          href={`/api/report/${report.youtube_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Raw JSON
        </a>
      </div>
    );
  }

  return (
    <main className="relative isolate min-h-screen flex flex-col overflow-hidden bg-canvas text-ink report-root">
      <div aria-hidden className="aurora aurora-report" />
      <div aria-hidden className="aurora aurora-report-b" />
      <div aria-hidden className="grain" />

      <Slate />

      <header className="relative z-[1] flex flex-col px-[clamp(32px,5vw,64px)] pt-[clamp(48px,7vw,96px)] pb-[clamp(32px,4vw,48px)]">
        <h1 className="m-0 font-serif font-light text-ink leading-[0.94] tracking-[-0.028em] text-[clamp(56px,7.6vw,112px)] [font-variation-settings:'SOFT'_100]">
          A clip you&apos;d like{" "}
          <em className="italic font-normal text-grad-lavender [font-variation-settings:'SOFT'_100]">decoded.</em>
        </h1>
        <h2 className="font-serif italic font-normal text-body-strong mt-7 max-w-[760px] tracking-[-0.01em] text-[clamp(22px,2.4vw,32px)] [font-variation-settings:'SOFT'_80]">
          {report.title}
        </h2>
        <ul className="list-none m-0 p-0 mt-8 flex flex-wrap gap-0 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          <li className="px-4 first:pl-0 first:border-l-0 border-l border-hairline-soft">{report.channel}</li>
          <li className="px-4 first:pl-0 first:border-l-0 border-l border-hairline-soft">{formatDuration(report.duration_s)}</li>
          <li className="px-4 first:pl-0 first:border-l-0 border-l border-hairline-soft">{stats.shots} shots</li>
          <li className="px-4 first:pl-0 first:border-l-0 border-l border-hairline-soft">Analysed {formatDate(report.created_at)}</li>
          {stats.wikiHits > 0 && (
            <li className="px-4 first:pl-0 first:border-l-0 border-l border-hairline-soft">
              Wiki <span className="text-ink font-medium">{stats.wikiHits}</span>/{stats.total}
            </li>
          )}
        </ul>
      </header>

      <section
        ref={playerContainerRef}
        className="relative z-[1] scroll-mt-6 grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] items-start gap-8 px-[clamp(32px,5vw,64px)] pb-8"
      >
        <div className="flex flex-col gap-3">
          <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
          <p className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted">Click any reference card to seek the player</p>
        </div>
        <SummaryCard stats={stats} />
      </section>

      <FilterBar
        verdictCounts={{
          confirmed: stats.confirmed,
          speculative: stats.speculative,
          hidden: stats.hidden,
        }}
        typeCounts={Object.fromEntries(
          stats.typeBreakdown.map((t) => [t.type, t.count]),
        )}
        availableTypes={stats.availableTypes}
        selectedVerdicts={selectedVerdicts}
        selectedTypes={selectedTypes}
        onToggleVerdict={toggleVerdict}
        onToggleType={toggleType}
      />

      <div className="ref-grid relative z-[1] grid gap-[18px] py-8 px-[clamp(32px,5vw,64px)] grid-cols-[repeat(auto-fit,minmax(min(440px,100%),1fr))]">
        {filteredRefs.length === 0 ? (
          <div
            className="font-sans text-[12px] font-semibold uppercase tracking-uc text-muted col-span-full text-center p-12"
          >
            All references filtered out. Re-enable a chip above.
          </div>
        ) : (
          filteredRefs.map((ref) => {
            const frame = frameById.get(ref.source_frame_id);
            const paletteHex = frame?.palette_hex ?? [];
            const paletteDescriptors = frame?.palette ?? [];
            const idx = report.references.indexOf(ref);
            return (
              <ReferenceCard
                key={`${ref.source_frame_id}-${idx}`}
                reference={ref}
                index={idx}
                paletteHex={paletteHex}
                paletteDescriptors={paletteDescriptors}
                youtubeId={report.youtube_id}
                onJump={() => jumpTo(ref)}
              />
            );
          })
        )}
      </div>

    </main>
  );
}

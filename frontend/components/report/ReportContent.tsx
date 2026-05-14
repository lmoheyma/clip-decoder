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
      <div className="slate">
        <BrandMark />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <button type="button" className="slate-link" onClick={shareLink}>
          {shareToast ? "Link copied" : "Share ↗"}
        </button>
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
    <main className="frame surface-dark relative min-h-screen flex flex-col report-root">
      <div aria-hidden className="aurora aurora-report" />
      <div aria-hidden className="aurora aurora-report-b" />
      <div aria-hidden className="grain" />

      <Slate />

      <header className="report-header">
        <h1 className="report-h1">
          A clip you&apos;d<br />like{" "}
          <em className="report-h1-em">decoded.</em>
        </h1>
        <h2 className="report-title">{report.title}</h2>
        <ul className="report-meta">
          <li>{report.channel}</li>
          <li>{formatDuration(report.duration_s)}</li>
          <li>{stats.shots} shots</li>
          <li>Analysed {formatDate(report.created_at)}</li>
          {stats.wikiHits > 0 && (
            <li>
              Wiki <span className="meta-num">{stats.wikiHits}</span>/{stats.total}
            </li>
          )}
        </ul>
      </header>

      <section className="player-row">
        <div className="player-container">
          <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
          <p className="hairline">Click any reference card to seek the player</p>
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

      <div className="grid">
        {filteredRefs.length === 0 ? (
          <div
            className="hairline"
            style={{
              gridColumn: "1/-1",
              textAlign: "center",
              padding: 48,
            }}
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

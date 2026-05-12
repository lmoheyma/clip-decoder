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
  Confidence,
  FrameAnalysis,
  PipelineEvent,
  Report,
  VerifiedReference,
} from "@/lib/types";
import { computeReportStats } from "@/lib/reportStats";
import { PipelineStatus } from "@/components/PipelineStatus";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/VideoPlayer";
import { FilterBar } from "@/components/FilterBar";
import { SummaryCard } from "@/components/SummaryCard";
import { ReferenceCard } from "@/components/ReferenceCard";

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

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState(false);
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

  const stats = useMemo(
    () => (report ? computeReportStats(report) : null),
    [report],
  );

  const [selectedVerdicts, setSelectedVerdicts] = useState<Set<Confidence>>(
    new Set<Confidence>(["confirmed", "speculative"]),
  );
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  // Initialize selectedTypes once the report loads (one-shot, all types on)
  useEffect(() => {
    if (stats && selectedTypes.size === 0 && stats.availableTypes.length > 0) {
      setSelectedTypes(new Set(stats.availableTypes));
    }
  }, [stats, selectedTypes.size]);

  // FrameAnalysis lookup by frame_id for palette joining
  const frameById = useMemo(() => {
    const m = new Map<string, FrameAnalysis>();
    if (report) {
      for (const f of report.frame_analyses) m.set(f.frame_id, f);
    }
    return m;
  }, [report]);

  const filteredRefs = useMemo(() => {
    if (!report) return [];
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
  async function handleFlag(idx: number) {
    await flagReference(id, idx);
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

  function Slate({
    youtubeId,
    duration,
    shots,
    refs,
  }: {
    youtubeId: string;
    duration: number;
    shots: number;
    refs: number;
  }) {
    return (
      <div className="slate">
        <span className="dot" />
        <b>ClipDecoder</b>
        <span className="slate-context">Report</span>
        <span className="sep" />
        <span className="tc">{youtubeId}</span>
        <span className="tc">{formatDuration(duration)}</span>
        <span className="tc">
          {shots} shots · {refs} references
        </span>
        <span className="sep" />
        <button type="button" className="slate-action" onClick={shareLink}>
          {shareToast ? "Link copied" : "Share ↗"}
        </button>
        <a
          className="slate-action"
          href={`/api/report/${id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Raw JSON
        </a>
      </div>
    );
  }

  // Loading state
  if (!report && !error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div style={{ padding: "clamp(32px, 5vw, 64px)" }}>
          <PipelineStatus events={events} />
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main className="frame surface-dark relative min-h-screen flex flex-col">
        <div className="slate">
          <span className="dot" />
          <b>ClipDecoder</b>
          <span className="slate-context">Report</span>
          <span className="sep" />
          <span className="tc">{id}</span>
        </div>
        <div
          style={{ padding: "clamp(32px, 5vw, 64px)", maxWidth: 720 }}
        >
          <div
            className="hairline"
            style={{ marginBottom: 16, color: "var(--error)" }}
          >
            Pipeline error
          </div>
          <h1
            className="serif-it"
            style={{
              fontSize: "clamp(28px, 4vw, 48px)",
              color: "var(--ink)",
            }}
            role="alert"
          >
            {error}
          </h1>
          <Link
            className="ulink"
            href="/"
            style={{ marginTop: 24, display: "inline-block" }}
          >
            ← Try another clip
          </Link>
        </div>
      </main>
    );
  }

  if (!report || !stats) return null;

  return (
    <main className="frame surface-dark relative min-h-screen flex flex-col">
      <Slate
        youtubeId={report.youtube_id}
        duration={report.duration_s}
        shots={stats.shots}
        refs={stats.total}
      />

      <header className="report-header">
        <h1 className="serif-it report-h1">
          A clip you'd<br />like{" "}
          <em
            style={{ color: "var(--grad-lavender)", fontStyle: "italic" }}
          >
            decoded.
          </em>
        </h1>
        <h2 className="serif-it report-title">{report.title}</h2>
        <div className="report-meta">
          <span>{report.channel}</span>
          <span>·</span>
          <span>{formatDuration(report.duration_s)}</span>
          <span>·</span>
          <span>{stats.shots} shots</span>
          <span>·</span>
          <span>Analysed {formatDate(report.created_at)}</span>
          {stats.wikiHits > 0 && (
            <>
              <span>·</span>
              <span>
                Wikipedia verified ({stats.wikiHits}/{stats.total})
              </span>
            </>
          )}
        </div>
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
                paletteHex={paletteHex}
                paletteDescriptors={paletteDescriptors}
                youtubeId={report.youtube_id}
                onJump={() => jumpTo(ref)}
                onFlag={() => handleFlag(idx)}
              />
            );
          })
        )}
      </div>

      <footer className="report-footer">
        <span>Run · {report.youtube_id}</span>
        <span>
          Wikipedia hits · {stats.wikiHits} / {stats.total}
        </span>
        <span>
          References · {stats.confirmed} confirmed · {stats.speculative}{" "}
          speculative · {stats.hidden} hidden
        </span>
      </footer>
    </main>
  );
}

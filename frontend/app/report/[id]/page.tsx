"use client";
import { useEffect, useRef, useState } from "react";
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
    async function load() {
      const r = await fetchReport(id);
      if (cancelled) return;
      if (r) setReport(r);
      else {
        const close = subscribePipeline(
          id,
          async (e) => {
            setEvents((prev) => [...prev, e]);
            if (e.step === "done") {
              const fresh = await fetchReport(id);
              if (!cancelled) setReport(fresh);
            }
            if (e.step === "error") setError(e.message);
          },
          (err) => setError(String(err)),
        );
        return () => close();
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id]);

  function jump(ref: VerifiedReference) {
    playerRef.current?.seekTo(ref.timestamp_s);
  }

  async function flag(idx: number) {
    await flagReference(id, idx);
  }

  return (
    <main className="surface-dark min-h-screen px-6 py-10">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">
        <header className="flex items-baseline justify-between">
          <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
            Report · {id}
          </p>
          {report && (
            <ConfidenceFilter
              showSpeculative={showSpeculative}
              onToggle={setShowSpeculative}
            />
          )}
        </header>

        {!report && <PipelineStatus events={events} />}
        {error && <p className="text-brand-orange">{error}</p>}

        {report && (
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-8">
            <div className="flex flex-col gap-4">
              <h1 className="font-display text-[40px] tracking-h2 leading-[1.20]">
                {report.title}
              </h1>
              <p className="font-mono uppercase text-[11px] tracking-mono-label text-white/60">
                {report.channel}
              </p>
              <VideoPlayer ref={playerRef} youtubeId={report.youtube_id} />
            </div>
            <ReferencePanel
              references={report.references}
              showSpeculative={showSpeculative}
              onJump={jump}
              onFlag={flag}
            />
          </div>
        )}
      </div>
    </main>
  );
}

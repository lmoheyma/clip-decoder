"use client";
import { useRouter } from "next/navigation";
import { HeroForm } from "@/components/HeroForm";

export default function Home() {
  const router = useRouter();
  return (
    <main className="bg-pastel-cloud min-h-screen flex flex-col items-center justify-center px-6 gap-12">
      <header className="text-center">
        <p className="font-mono uppercase text-[11px] tracking-mono-label text-black/60 mb-4">
          ClipDecoder
        </p>
        <h1 className="font-display tracking-display text-[64px] leading-[1.05]">
          Decode the visual<br />references in any clip.
        </h1>
        <p className="mt-6 text-[18px] tracking-body text-black/60 max-w-xl mx-auto">
          Paste a YouTube URL. Get an annotated viewer with named, evidence-grounded references — films, paintings, photographs, other clips.
        </p>
      </header>
      <HeroForm onSubmit={(r) => router.push(`/report/${r.youtube_id}`)} />
    </main>
  );
}

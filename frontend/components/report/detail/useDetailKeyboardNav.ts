"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useDetailKeyboardNav({
  youtubeId,
  index,
  total,
}: {
  youtubeId: string;
  index: number;
  total: number;
}) {
  const router = useRouter();
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "ArrowLeft" && index > 0) {
        router.push(`/report/${youtubeId}/ref/${index - 1}`);
      } else if (e.key === "ArrowRight" && index < total - 1) {
        router.push(`/report/${youtubeId}/ref/${index + 1}`);
      } else if (e.key === "Escape") {
        router.push(`/report/${youtubeId}`);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, youtubeId, index, total]);
}

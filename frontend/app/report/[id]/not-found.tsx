import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export default function ReportNotFound() {
  return (
    <main className="frame surface-dark home-root">
      <div aria-hidden className="aurora" />
      <div aria-hidden className="aurora aurora-b" />
      <div aria-hidden className="grain" />

      <div className="home-shell">
        <div className="slate">
          <BrandMark />
          <b>ClipDecoder</b>
          <span className="sep" />
        </div>

        <section className="home-stage">
          <h1 className="home-h1">
            No <em className="home-h1-em">report</em>
            <br />
            with that id.
            <span className="home-h1-sub">
              The clip was never analyzed, or its record was cleared.
            </span>
          </h1>

          <Link href="/" className="not-found-cta">
            ← Analyze a new clip
          </Link>
        </section>
      </div>
    </main>
  );
}

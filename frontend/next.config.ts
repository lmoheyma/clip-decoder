import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Disable gzip on the Next.js server. Without this, the dev server
  // compresses /api/stream/* responses and gzip buffers chunks until
  // it has enough data to flush — which means the browser sees zero
  // SSE events until the pipeline is done. Curl works because it does
  // not send Accept-Encoding by default; browsers do, so they hit the
  // compression path. (In production we sit behind a reverse proxy
  // that controls compression at its layer.)
  compress: false,
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
};

export default config;

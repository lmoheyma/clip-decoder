import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ClipDecoder",
  description: "Decode the visual references in your favorite music videos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

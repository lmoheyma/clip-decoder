import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";

// Fraunces — variable serif with italic, opticalSize, and SOFT axis for an
// editorial film-essay register on the hero and reference titles.
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// JetBrains Mono — archival metadata: timecode, entry number, step numerals,
// the URL input field. Adds a "technical dossier" feel against the serif.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClipDecoder — Every shot is a quotation. We name the source.",
  description:
    "Paste a music video. ClipDecoder splits it into shots, asks a vision model what it sees, then cross-references each frame against a library of films, paintings, photographs, and other clips.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";
import { EB_Garamond, Inter } from "next/font/google";

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-eb-garamond",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
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
    <html lang="en" className={`${ebGaramond.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}

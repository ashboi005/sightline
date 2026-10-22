import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from "next/font/google";

import "katex/dist/katex.min.css";
import "../index.css";
import Providers from "@/components/providers";

// Atkinson Hyperlegible was drawn by the Braille Institute for low-vision readers:
// letterforms that can't be mistaken for each other (I l 1, O 0, rn m) matter when captions are the product.
const atkinson = Atkinson_Hyperlegible_Next({
  variable: "--font-atkinson",
  subsets: ["latin"],
  // next/font has no metric overrides for this family yet, so name the fallbacks ourselves.
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const atkinsonMono = Atkinson_Hyperlegible_Mono({
  variable: "--font-atkinson-mono",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: {
    default: "Sightline: live captions that follow your eyes",
    template: "%s · Sightline",
  },
  description:
    "A classroom workspace for deaf and hard-of-hearing students. Captions pause when you look at the board, fix subject jargon, render spoken formulas, and turn your signs into speech.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) add attributes to <body> before React loads */}
      <body className={`${atkinson.variable} ${atkinsonMono.variable} antialiased`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

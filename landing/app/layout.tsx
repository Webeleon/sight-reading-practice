import type { Metadata, Viewport } from "next";
import { Archivo, DM_Mono } from "next/font/google";
import "./globals.css";

/*
 * Fonts ported from the CDN <link> in the mockup to next/font/google.
 * The `variable` exposes each family as a CSS custom property, which
 * app/globals.css aliases onto --disp / --mono so the ported design
 * system keeps working unchanged.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "800", "900"],
  variable: "--font-disp",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_TITLE = "Sight Reading — practice reading music on your guitar";
const SITE_DESCRIPTION =
  "A sight-reading gym for guitarists. A fresh line every day, instant note-by-note feedback, and proof you're actually getting better. Download the free prototype.";

/*
 * Production origin. Used for metadataBase so relative OG/Twitter image and
 * canonical URLs resolve to absolute https URLs (instead of localhost) and to
 * silence Next's build-time warning. Override per-environment with
 * NEXT_PUBLIC_SITE_URL (e.g. a Vercel preview URL).
 */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://sight-reading.webeleon.dev";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "Sight Reading",
  authors: [{ name: "webeleon" }],
  keywords: [
    "sight reading",
    "guitar",
    "music practice",
    "pitch detection",
    "ear training",
    "fretboard",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    siteName: "Sight Reading",
    url: "/",
    // Image is auto-wired by app/opengraph-image.tsx; Next injects the absolute
    // URL (resolved against metadataBase) and dimensions into the tags.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    // twitter image is auto-wired from app/opengraph-image.tsx as well.
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ECE7DA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${dmMono.variable}`}>
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

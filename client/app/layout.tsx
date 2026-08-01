import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Display. The `wdth` axis (62–125) is the whole reason this face was chosen: set wide, Archivo
// reads as stamped metal signage rather than as a UI font. There is no "Archivo Expanded" family
// in next/font — the width has to come from the variable axis.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Not a stylistic choice: hex addresses, 6-decimal amounts and block numbers have to align in
// columns. IBM Plex Mono has no variable cut, so the weights are listed.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "The Kill Switch",
    template: "%s · The Kill Switch",
  },
  description:
    "A policy-enforcing wallet for autonomous AI agents. Spend limits live in contract storage, not in a prompt — and the owner can freeze the agent mid-transaction.",
};

export const viewport: Viewport = {
  themeColor: "#313A36",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="m-chassis flex min-h-full flex-col">{children}</body>
    </html>
  );
}

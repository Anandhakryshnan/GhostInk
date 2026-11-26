import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "GhostInk",
  description:
    "Hide encrypted secrets inside ordinary text using invisible Unicode characters. End-to-end encrypted in your browser with zero backend.",
  keywords: [
    "GhostInk",
    "Unicode Steganography",
    "Zero-Width Characters",
    "Invisible Ink",
    "Web Crypto API",
    "AES-256-GCM",
    "Client-Side Encryption",
    "Steganalysis",
  ],
  openGraph: {
    title: "GhostInk — Invisible Unicode Steganography",
    description:
      "Hide encrypted secrets inside ordinary text using invisible Unicode characters. Zero backend, 100% browser-native.",
    type: "website",
    locale: "en_US",
    siteName: "GhostInk",
  },
  twitter: {
    card: "summary_large_image",
    title: "GhostInk — Invisible Unicode Steganography",
    description:
      "Hide encrypted secrets inside ordinary text using invisible Unicode characters.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground font-sans antialiased">
        {children}
      </body>
    </html>
  );
}

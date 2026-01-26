import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Modern Mesh Image Creator",
    template: "%s | Modern Mesh",
  },
  description: "Design and create needlepoint patterns with precision. Convert images to grid-based designs with DMC color matching.",
  keywords: ["needlepoint", "cross-stitch", "pattern design", "DMC colors", "pixel art", "mesh canvas"],
  authors: [{ name: "Modern Mesh" }],
  openGraph: {
    title: "Modern Mesh Image Creator",
    description: "Design and create needlepoint patterns with precision. Convert images to grid-based designs with DMC color matching.",
    type: "website",
    locale: "en_US",
    siteName: "Modern Mesh",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Modern Mesh - Needlepoint Pattern Designer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Modern Mesh Image Creator",
    description: "Design and create needlepoint patterns with precision.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-touch-icon.png",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "https://modern-mesh-image-creator.vercel.app"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

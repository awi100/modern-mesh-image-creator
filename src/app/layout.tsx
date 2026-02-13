import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SWRProvider } from "@/lib/swr-config";
import PWAProvider from "@/components/PWAProvider";
import { ToastProvider } from "@/components/Toast";
import { ThemeProvider } from "@/components/ThemeProvider";

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
    icon: [
      { url: "/icon.png", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
    shortcut: "/icon.png",
  },
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "https://modern-mesh-image-creator.vercel.app"),
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Modern Mesh",
  },
};

export const viewport: Viewport = {
  themeColor: "#881337",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <ToastProvider>
            <SWRProvider>
              <PWAProvider>{children}</PWAProvider>
            </SWRProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

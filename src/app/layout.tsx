import * as React from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { ErrorBoundary } from "react-error-boundary";
import { Geist, Geist_Mono } from "next/font/google";

import Loading from '@/app/loading';
import Error from '@/app/error';
import "@/styles/globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
    metadataBase: new URL('https://ruthcloud.xyz'),
    title: {
        template: '%s | RuthServer',
        default: 'RuthServer Cloud'
    },
    description: "RuthServer for multiple cloud platforms",
    manifest: "/manifest.json",
    applicationName: "RuthServer Cloud",
    keywords: [],
    authors: [{ name: "Ruthgyeul" }],
    creator: "Ruthgyeul",
    publisher: "Ruthgyeul",
    formatDetection: {
        telephone: true,
        date: true,
        address: true,
        email: true,
        url: true
    },
    icons: {
        icon: [
            { url: "/favicon.ico", sizes: "any", type: "image/x-icon" }
        ],
        shortcut: ["/favicon.ico"]
    },
    openGraph: {
        title: "RuthServer Cloud",
        description: "RuthServer for multiple cloud platforms",
        url: "https://ruthcloud.xyz",
        siteName: "RuthServer Cloud",
        images: [
            {
                url: "https://ruthcloud.xyz/screenshots/home.png",
                width: 1280,
                height: 720,
                alt: "RuthServer Home"
            }
        ],
        type: "website",
        locale: "en_US",
    },
    twitter: {
        card: "summary_large_image",
        title: "RuthServer Cloud",
        description: "RuthServer for multiple cloud platforms",
        images: ["https://ruthcloud.xyz/screenshots/home.png"],
        creator: "Ruthgyeul",
    },
    verification: {
        // Google Search Console 등에 사용되는 확인 코드가 있다면 추가
        // google: "VERIFICATION_CODE",
    },
    alternates: {
        canonical: 'https://ruthcloud.syz',
        languages: {
            'en-US': 'https://ruthcloud.xyz',
        },
    },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#111827"/>
        <link rel="manifest" href="/manifest.json"/>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="mobile-web-app-status-bar-style" content="default"/>
        <meta name="mobile-web-app-title" content="RuthServer"/>
        <title>RuthServer Cloud</title>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-auto bg-gray-900 text-gray-100`}
      >
        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<Loading />}>
            {children}
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  );
}

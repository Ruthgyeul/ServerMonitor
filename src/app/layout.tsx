import * as React from 'react';
import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { ErrorBoundary } from 'react-error-boundary';
import { Geist, Geist_Mono } from 'next/font/google';

import Loading from '@/app/loading';
import Error from '@/app/error';
import { SITE_URL, SITE_NAME, SITE_SHORT_NAME, SITE_DESCRIPTION, AUTHOR_NAME } from '@/config/siteConfig';
import '@/styles/globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin']
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin']
});

// On mobile, CSS pixels must follow the device width for the responsive layout
// to fold as intended. The scale is pinned to 1 so users can't pinch/double-tap to zoom.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  themeColor: '#0a0d13'
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: `%s | ${SITE_SHORT_NAME}`,
    default: SITE_NAME
  },
  description: SITE_DESCRIPTION,
  manifest: '/manifest.json',
  applicationName: SITE_NAME,
  keywords: [],
  authors: [{ name: AUTHOR_NAME }],
  creator: AUTHOR_NAME,
  publisher: AUTHOR_NAME,
  formatDetection: {
    telephone: true,
    date: true,
    address: true,
    email: true,
    url: true
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }
    ],
    shortcut: ['/favicon.svg']
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: `${SITE_URL}/screenshots/home.png`,
        width: 1280,
        height: 720,
        alt: `${SITE_SHORT_NAME} Home`
      }
    ],
    type: 'website',
    locale: 'en_US'
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/screenshots/home.png`],
    creator: AUTHOR_NAME
  },
  verification: {
    // Add a verification code here if one is used (e.g. Google Search Console)
    // google: "VERIFICATION_CODE",
  },
  alternates: {
    canonical: SITE_URL,
    languages: {
      'en-US': SITE_URL
    }
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* theme-color is injected by the viewport export above. */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-status-bar-style" content="default" />
        <meta name="mobile-web-app-title" content={SITE_SHORT_NAME} />
        <title>{SITE_NAME}</title>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-auto bg-gray-900 text-gray-100`}
      >
        <ErrorBoundary FallbackComponent={Error}>
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </ErrorBoundary>
      </body>
    </html>
  );
}

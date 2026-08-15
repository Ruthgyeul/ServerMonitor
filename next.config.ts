import type { NextConfig } from 'next';

// Security response headers. The dashboard has no reason to be embedded, so
// clickjacking is blocked outright, along with MIME sniffing / plugin injection / base-tag hijacking.
//
// The CSP is a minimal setup that doesn't restrict script/style/connect.
// Narrowing those three easily breaks Next's inline bootstrap, the inline
// styles of Tailwind/Recharts, and /cluster's cross-node fetch, so here we only
// enforce the definitely-safe frame-ancestors/object-src/base-uri. If a
// stricter CSP is needed, add script-src/connect-src to match the deployment (see README).
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // This dashboard uses no camera/microphone/geolocation, etc. Turn them all off.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  },
  // Browsers apply this only on HTTPS responses. It's ignored when served over HTTP, so it's safe.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains'
  }
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // don't advertise the stack/version via "X-Powered-By: Next.js"
  // Minimize the Docker image: only the files needed to run the server are pruned into .next/standalone.
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;

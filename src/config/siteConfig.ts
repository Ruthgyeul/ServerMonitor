// Centralized site metadata, sourced from environment variables so a fork/
// redeploy only requires editing .env instead of hunting through
// layout.tsx, robots.ts and sitemap.ts.

// Ensures a scheme is present and strips any trailing slash, so downstream
// string concatenation (e.g. `${SITE_URL}/sitemap.xml`) never produces a
// double slash and `new URL(SITE_URL)` never throws.
function normalizeSiteUrl(url: string): string {
    const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return withScheme.replace(/\/+$/, '');
}

export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL || 'https://ruthcloud.xyz');
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'RuthServer Cloud';
export const SITE_SHORT_NAME = process.env.NEXT_PUBLIC_SITE_SHORT_NAME || 'RuthServer';
export const SITE_DESCRIPTION = process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'RuthServer for multiple cloud platforms';
export const AUTHOR_NAME = process.env.NEXT_PUBLIC_AUTHOR_NAME || 'Ruthgyeul';

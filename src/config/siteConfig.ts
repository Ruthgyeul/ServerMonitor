// Centralized site metadata, sourced from environment variables so a fork/
// redeploy only requires editing .env instead of hunting through
// layout.tsx, robots.ts and sitemap.ts.

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ruthcloud.xyz';
export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'RuthServer Cloud';
export const SITE_SHORT_NAME = process.env.NEXT_PUBLIC_SITE_SHORT_NAME || 'RuthServer';
export const SITE_DESCRIPTION = process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'RuthServer for multiple cloud platforms';
export const AUTHOR_NAME = process.env.NEXT_PUBLIC_AUTHOR_NAME || 'Ruthgyeul';

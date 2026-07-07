import { SITE_URL } from '@/config/siteConfig';

export default function robots() {
    return {
        rules: [
            {
                userAgent: '*',
                allow: [
                    '/',
                    '/images/',
                    '/fonts/',
                    '/static/',
                ],
                disallow: [
                    '/api/',
                    '/_next/',
                    '/auth/',
                    '/context/',
                    '/private/',
                    '/admin/',
                    '/hooks/',
                    '/mock/',
                    '/utils/'
                ],
                crawlDelay: 5,
            },
            {
                userAgent: 'GPTBot',
                disallow: ['/'],
            },
            {
                userAgent: 'CCBot',
                disallow: ['/'],
            },
            {
                userAgent: 'Google-Extended',
                disallow: ['/'],
            },
            {
                userAgent: 'anthropic-ai',
                disallow: ['/'],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    }
}
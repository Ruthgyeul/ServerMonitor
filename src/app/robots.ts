import { SITE_URL } from '@/config/siteConfig';

export default function robots() {
    return {
        rules: [
            {
                userAgent: '*',
                allow: [],
                disallow: ['/'],
                crawlDelay: 5,
            }
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    }
}

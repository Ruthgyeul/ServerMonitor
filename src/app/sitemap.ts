import { SITE_URL } from '@/config/siteConfig';

export default function sitemap() {
    const baseUrl = SITE_URL;
    const currentDate = new Date().toISOString();

    const routes = [
        {
            url: baseUrl,
            lastModified: currentDate,
            changeFrequency: 'daily',
            priority: 1,
        }
    ];

    return routes;
}
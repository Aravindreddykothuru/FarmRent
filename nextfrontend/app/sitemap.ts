import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteUrl';

// Served at /sitemap.xml: the pages a visitor can open without signing in.
//
// Individual listings are left out on purpose. This file is generated when the site is built, and the build
// has no database to read listings from; they are reached by crawling /browse.
const PUBLIC_PAGES: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
    { path: '/', priority: 1, changeFrequency: 'weekly' },
    { path: '/browse', priority: 0.9, changeFrequency: 'daily' },
    { path: '/how-it-works', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/register', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/login', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/select-language', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/docs/gps-setup', priority: 0.3, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
    return PUBLIC_PAGES.map(({ path, priority, changeFrequency }) => ({
        url: path === '/' ? SITE_URL : `${SITE_URL}${path}`,
        changeFrequency,
        priority,
    }));
}

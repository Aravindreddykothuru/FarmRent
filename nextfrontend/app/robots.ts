import type { MetadataRoute } from 'next';
import { PROTECTED_PREFIXES } from '@/lib/authRoutes';
import { SITE_URL } from '@/lib/siteUrl';

// Served at /robots.txt. Without it the address answered 404 with the full "page not found" screen, which a
// crawler reads as "no rules" and then spends its visit on sign-in redirects.
//
// The signed-in pages are listed from the same table the proxy uses to guard them, so a page that starts
// requiring a session stops being offered to crawlers in the same change.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: [
                '/api/',
                '/dev/',
                // One-off links from emails: each is useless without the token it was sent with.
                '/reset-password',
                '/password-reset',
                '/verify-email',
                // A rule is a prefix match, so "/dashboard" already covers everything beneath it.
                ...PROTECTED_PREFIXES,
            ],
        },
        sitemap: `${SITE_URL}/sitemap.xml`,
    };
}

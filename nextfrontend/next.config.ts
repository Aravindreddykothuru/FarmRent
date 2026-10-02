import path from "path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const BACKEND = process.env.INTERNAL_API_URL
    || process.env.NEXT_PUBLIC_API_URL
    || process.env.NEXT_PUBLIC_BACKEND_URL
    || 'http://localhost:3000'; // unified server port (Next.js + Express)

const nextConfig: NextConfig = {
    /* CDN Asset Prefix routing */
    assetPrefix: process.env.CDN_URL || undefined,

    /* Allow localtunnel + other dev proxy origins to access /_next/* resources
       without the "Cross origin request detected" warning. */
    allowedDevOrigins: [
        '*.loca.lt',
        'localhost',
    ],

    /* Proxy all /api/v1 and /socket.io requests to the Node backend so
       the browser only ever talks to http://localhost:3000. */
    async rewrites() {
        return [
            {
                source: '/api/v1/:path*',
                destination: `${BACKEND}/api/v1/:path*`,
            },
            {
                source: '/socket.io/:path*',
                destination: `${BACKEND}/socket.io/:path*`,
            },
        ];
    },

    outputFileTracingRoot: path.join(__dirname, '..'),

    /* Tell Turbopack to compile lucide-react icons individually instead of
       tree-shaking the whole barrel file. Prevents the "Quote module factory
       not available after HMR update" runtime crash. */
    experimental: {
        optimizePackageImports: ['lucide-react'],
        clientTraceMetadata: ['sentry-trace', 'baggage'],
    },

    /* Security headers + cache policy.
       Static assets get no-store in dev so Turbopack HMR always serves fresh
       chunks (avoids stale-bundle "Something went wrong" errors). */
    async headers() {
        const isProd = process.env.NODE_ENV === 'production';
        return [
            {
                source: '/(.*)',
                headers: [
                    { key: 'X-Content-Type-Options',   value: 'nosniff' },
                    { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
                    { key: 'X-XSS-Protection',          value: '1; mode=block' },
                    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
                    { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(self)' },
                ],
            },
            {
                source: '/_next/static/(.*)',
                headers: isProd
                    ? [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]
                    : [{ key: 'Cache-Control', value: 'no-store' }],
            },
        ];
    },

    /* Allow images from common CDN / Supabase / AWS S3 origins */
    images: {
        remotePatterns: [
            { protocol: 'https', hostname: '*.supabase.co' },
            { protocol: 'https', hostname: 'images.unsplash.com' },
            { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
            { protocol: 'https', hostname: '*.cloudfront.net' },
            { protocol: 'https', hostname: '*.amazonaws.com' },
        ],
    },
};

const isSentryEnabled = !!process.env.SENTRY_AUTH_TOKEN;

export default isSentryEnabled
    ? withSentryConfig(nextConfig, {
          silent: true,
      } as any)
    : nextConfig;


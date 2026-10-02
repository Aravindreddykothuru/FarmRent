import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isProtectedPath } from './lib/authRoutes';

// Routes that logged-in users should not see
const AUTH_ONLY_PAGES = [
    '/login',
    '/register',
    '/forgot-password',
];

// Dev-only routes — never redirect, always allow
const DEV_BYPASS = ['/dev/'];

// Routes only accessible by admins
const ADMIN_ONLY = ['/dashboard/admin'];

function isAuthOnly(pathname: string) {
    return AUTH_ONLY_PAGES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAdminOnly(pathname: string) {
    return ADMIN_ONLY.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function dashboardFor(role: string | undefined): string {
    if (role === 'owner') return '/dashboard/owner';
    if (role === 'admin') return '/dashboard/admin';
    return '/dashboard/farmer';
}

function isSafeNext(next: string): boolean {
    return next.startsWith('/') && !next.startsWith('//') && !next.includes(':');
}

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Always allow dev routes (email inbox, etc.)
    if (DEV_BYPASS.some(p => pathname.startsWith(p))) return NextResponse.next();

    // Check authRole and secure token cookie presence (both must exist)
    const token = request.cookies.get('token')?.value;
    const authRole = request.cookies.get('authRole')?.value?.trim();
    const loggedIn = Boolean(token && authRole);

    // Unauthenticated → protected route: send to login with return path
    if (isProtectedPath(pathname) && !loggedIn) {
        const url = request.nextUrl.clone();
        url.pathname = '/login';
        url.search = '';
        url.searchParams.set('next', pathname);
        return NextResponse.redirect(url);
    }

    // Authenticated → auth-only page: send to dashboard (honour ?next= if safe)
    if (isAuthOnly(pathname) && loggedIn) {
        const next = request.nextUrl.searchParams.get('next') ?? '';
        const url = request.nextUrl.clone();
        url.search = '';
        url.pathname = isSafeNext(next) ? next : dashboardFor(authRole);
        return NextResponse.redirect(url);
    }

    // Non-admin → admin-only route: redirect to own dashboard
    if (isAdminOnly(pathname) && authRole !== 'admin') {
        const url = request.nextUrl.clone();
        url.pathname = dashboardFor(authRole);
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon\\.ico).*)',
    ],
};

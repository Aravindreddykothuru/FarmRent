// Pages that need a signed-in user. Shared by the proxy (server-side redirect before render) and the API
// client (an expired session on one of these pages sends the user back to login).
export const PROTECTED_PREFIXES = [
    '/dashboard',
    '/bookings',
    '/book',
    '/offers',
    '/chats',
    '/disputes',
    '/wishlist',
    '/add-equipment',
    '/edit-equipment',
    '/tracking',
    '/payment',
    '/driver',
    '/profile',
    '/ai-assistant',
    '/analytics',
    '/wallet',
    '/notifications',
    '/kyc',
];

export function isProtectedPath(pathname: string): boolean {
    return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

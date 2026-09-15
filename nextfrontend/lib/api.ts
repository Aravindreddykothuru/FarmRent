/**
 * api.ts — Central API client for FarmRent (Next.js)
 *
 * With `npm run dev` / `npm start` (unified server), API is same-origin (port 3000).
 * Set NEXT_PUBLIC_API_URL if the API is on another host/port.
 * Node proxies /api/v2/* → Flask when Flask is running.
 */

import { toast } from 'sonner';
import { isProtectedPath } from './authRoutes';

let lastNetworkToastTime = 0;
function notifyNetworkError(description: string) {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    if (now - lastNetworkToastTime > 4000) {
        lastNetworkToastTime = now;
        toast.error('API Server Unreachable', {
            id: 'network-error-toast',
            description,
            duration: 4000,
        });
    }
}

export function getApiBaseUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined') return '';
  return (process.env.INTERNAL_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/** Resolve per request so env/caller context is never stale (import-time const broke SSR vs client). */
function getNodeApiBase(): string {
  const b = getApiBaseUrl();
  return b ? `${b}/api/v1` : '/api/v1';
}

function getFlaskApiBase(): string {
  const b = getApiBaseUrl();
  return b ? `${b}/api/v2` : '/api/v2';
}

// ─── Token helpers ────────────────────────────────────────────────────────────
// Token is now sent automatically via httpOnly cookie.

const authHeaders = (): Record<string, string> => ({});

/**
 * True when this browser holds a session. The server sets the readable authRole cookie next to the httpOnly
 * token cookies (same lifetime as the refresh token) and clears it on logout.
 */
export function hasSessionHint(): boolean {
    return typeof document !== 'undefined' && /(?:^|;\s*)authRole=[^;]+/.test(document.cookie);
}

// ─── Token refresh (deduped to avoid refresh storms on simultaneous 401s) ────
type RefreshOutcome = 'refreshed' | 'expired' | 'unavailable';
let refreshPromise: Promise<RefreshOutcome> | null = null;

async function refreshAccessToken(): Promise<RefreshOutcome> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch(`${getNodeApiBase()}/auth/refresh`, { method: 'POST', credentials: 'include' })
        // Only the server rejecting the refresh token ends the session; rate limits and outages do not.
        .then((r): RefreshOutcome => (r.ok ? 'refreshed' : r.status === 401 || r.status === 403 ? 'expired' : 'unavailable'))
        .catch((): RefreshOutcome => 'unavailable')
        .finally(() => { refreshPromise = null; });
    return refreshPromise;
}

function endExpiredSession() {
    if (typeof window === 'undefined') return;
    document.cookie = 'authRole=; path=/; SameSite=Lax; max-age=0';
    // Public pages keep working signed out; protected pages return to login and come back afterwards.
    const { pathname } = window.location;
    if (isProtectedPath(pathname)) {
        window.location.href = `/login?reason=session_expired&next=${encodeURIComponent(pathname)}`;
    }
}

// ─── Unwrap standard API envelope { success, data, error, timestamp } ───────
function unwrapEnvelope<T>(body: unknown): T {
    if (
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        'success' in body &&
        'data' in body &&
        'error' in body
    ) {
        const env = body as {
            success: boolean;
            data: T;
            error: { message?: string } | null;
        };
        if (!env.success && env.error) {
            throw new Error(env.error.message || 'Request failed');
        }
        return env.data;
    }
    return body as T;
}

// ─── Base fetch wrapper ───────────────────────────────────────────────────────
async function request<T>(
    base: string,
    path: string,
    options: RequestInit = {},
    _isRetry = false
): Promise<T> {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

    const isFormData = options.body instanceof FormData;
    const headers: Record<string, string> = {
        ...authHeaders(),
        ...(options.headers as Record<string, string> ?? {}),
    };
    if (!isFormData) {
        headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
        res = await fetch(url, {
            ...options,
            credentials: 'include',
            headers,
        });
    } catch (e) {
        const hint =
            typeof window !== 'undefined' && url.includes('localhost:5000')
                ? ' API is configured for port 5000 but nothing is listening — use unified dev on :3000 or set NEXT_PUBLIC_API_URL in .env.local.'
                : ' Check that the dev server is running and NEXT_PUBLIC_API_URL matches the API port.';
        const msg = e instanceof Error ? e.message : 'Network error';
        const fullErrorMsg = `${msg}.${hint}`;
        notifyNetworkError(fullErrorMsg);
        throw new Error(fullErrorMsg);
    }

    // ── 401 → attempt silent token refresh, retry once (except auth login/register/reset endpoints) ──
    const isAuthRequest = path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/forgot-password') || path.includes('/auth/reset-password');
    if (res.status === 401 && !isAuthRequest && !path.includes('/auth/refresh')) {
        // Signed-out visitor: nothing to refresh and nowhere to redirect — the caller decides what to show.
        if (!hasSessionHint()) throw new Error('Please sign in to continue.');
        if (!_isRetry) {
            const outcome = await refreshAccessToken();
            if (outcome === 'refreshed') return request<T>(base, path, options, true);
            if (outcome === 'unavailable') throw new Error('Could not confirm your session right now. Please try again.');
        }
        endExpiredSession();
        throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body && typeof body === 'object') {
                if (body.error && typeof body.error === 'object' && body.error.message) {
                    errorMsg = body.error.message;
                } else {
                    errorMsg = body.message ?? body.error ?? errorMsg;
                }
            }
        } catch { /* ignore */ }
        throw new Error(String(errorMsg));
    }

    if (res.status === 204) return undefined as T;
    const body = await res.json();
    return unwrapEnvelope<T>(body);
}

// ─── Node.js API client (/api/v1) ─────────────────────────────────────────────
export const nodeApi = {
    get: <T>(path: string) => request<T>(getNodeApiBase(), path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(getNodeApiBase(), path, { method: 'DELETE' }),
    uploadForm: <T>(path: string, formData: FormData) => request<T>(getNodeApiBase(), path, { method: 'POST', body: formData }),
};

// ─── Flask API client (/api/v2 → Flask /api) ──────────────────────────────────
export const flaskApi = {
    get: <T>(path: string) => request<T>(getFlaskApiBase(), path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => request<T>(getFlaskApiBase(), path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => request<T>(getFlaskApiBase(), path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => request<T>(getFlaskApiBase(), path, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(getFlaskApiBase(), path, { method: 'DELETE' }),
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────
export const auth = {
    login: (email: string, password: string) =>
        nodeApi.post<{ token: string; user: unknown }>('/auth/login', { email, password }),
    register: (data: unknown) =>
        nodeApi.post<{ token: string; user: unknown }>('/auth/register', data),
    logout: () =>
        // Calls the backend to clear the httpOnly session cookie. Also clears any legacy localStorage token.
        nodeApi.post('/auth/logout', {}).finally(() => {
            if (typeof window !== 'undefined') localStorage.removeItem('authToken');
        }),
    setToken: (token: string) => { if (typeof window !== 'undefined') localStorage.setItem('authToken', token); },
};

// ─── Machine endpoints ────────────────────────────────────────────────────────
export const machines = {
    search: (params: Record<string, string | number | boolean>) =>
        nodeApi.get(`/machines?${new URLSearchParams(params as Record<string, string>)}`),
    getById: (id: string) => nodeApi.get(`/machines/${id}`),
    create: (data: unknown) => nodeApi.post('/machines', data),
    update: (id: string, data: unknown) => nodeApi.patch(`/machines/${id}`, data),
    delete: (id: string) => nodeApi.delete(`/machines/${id}`),
    availability: (id: string, from: string, to: string) =>
        nodeApi.get(`/machines/${id}/availability?from=${from}&to=${to}`),
};

// ─── Booking endpoints ────────────────────────────────────────────────────────
export const bookings = {
    create: (data: unknown) => nodeApi.post('/bookings', data),
    getById: (id: string) => nodeApi.get(`/bookings/${id}`),
    myBookings: () => nodeApi.get('/bookings/my'),
    cancel: (id: string) => nodeApi.patch(`/bookings/${id}/cancel`, {}),
};

// ─── ML endpoints (Node backend) ─────────────────────────────────────────────
export const mlNode = {
    getDemandPrediction: (params: Record<string, string>) =>
        nodeApi.get(`/ml/demand-prediction?${new URLSearchParams(params)}`),
    getRecommendations: (params: Record<string, string>) =>
        nodeApi.get(`/ml/recommendations?${new URLSearchParams(params)}`),
    getOptimalPricing: (data: unknown) => nodeApi.post('/ml/optimal-pricing', data),
    getChurnRisk: () => nodeApi.get('/ml/churn-risk'),
};

// ─── GPS tracking (Flask) ─────────────────────────────────────────────────────
export const gps = {
    logLocation: (data: { user_id: number; latitude: number; longitude: number; altitude?: number; speed?: number }) =>
        flaskApi.post('/gps/log', data),
    getCurrentLocation: (userId: number) => flaskApi.get(`/gps/current/${userId}`),
    getRoute: (userId: number) => flaskApi.get(`/gps/route/${userId}`),
};

// ─── Insurance (Flask) ────────────────────────────────────────────────────────
export const insurance = {
    createPolicy: (data: unknown) => flaskApi.post('/insurance/policy/create', data),
    createClaim: (data: unknown) => flaskApi.post('/insurance/claim/create', data),
    approveClaim: (data: unknown) => flaskApi.post('/insurance/claim/approve', data),
};

// ─── Payments ─────────────────────────────────────────────────────────────────
// ⚠️  DEPRECATED: These methods return HTTP 410. Use `razorpayApi.*` instead.
export const payments = {
    /** @deprecated Use razorpayApi.createOrder() */
    initiate:  (data: unknown) => nodeApi.post('/payments/initiate', data),
    /** @deprecated Use razorpayApi.verify() */
    confirm:   (data: unknown) => nodeApi.post('/payments/confirm', data),
    /** @deprecated Use razorpayApi.refund() */
    refund:    (data: unknown) => nodeApi.post('/payments/refund', data),
    /** @deprecated Razorpay Checkout handles card validation client-side */
    validateCard: (data: unknown) => nodeApi.post('/payments/validate-card', data),
    // Legacy Flask-proxied helpers kept for backwards compat
    createPayment: (data: unknown) => flaskApi.post('/payments/create', data),
    createSubscription: (data: unknown) => flaskApi.post('/payments/subscribe', data),
};

// ─── Admin API ────────────────────────────────────────────────────────────────
export const adminApi = {
    getDashboard:   () => nodeApi.get<{ success: boolean; data: Record<string, unknown> }>('/admin/dashboard'),
    getMachines:    () => nodeApi.get<{ success: boolean; data: unknown[] }>('/admin/machines'),
    approveMachine: (id: string) => nodeApi.patch(`/admin/machines/${id}/approve`, {}),
    getUsers:       () => nodeApi.get<{ success: boolean; data: unknown[] }>('/admin/users'),
    getBookings:    () => nodeApi.get<{ success: boolean; data: unknown[] }>('/admin/bookings'),
};

// ─── Notifications API ────────────────────────────────────────────────────────
export const notificationsApi = {
    list: () => nodeApi.get<{ success: boolean; notifications: unknown[]; unreadCount: number }>('/notifications'),
    markRead: (id: string) => nodeApi.patch(`/notifications/${id}/read`, {}),
    markAllRead: () => nodeApi.patch('/notifications/read-all', {}),
};

// ─── User Profile ─────────────────────────────────────────────────────────────
export const userProfile = {
    get: () => nodeApi.get<{ success: boolean; user: Record<string, unknown> }>('/users/profile'),
    update: (data: { name?: string; phone?: string; avatar_url?: string }) =>
        nodeApi.patch<{ success: boolean; user: Record<string, unknown> }>('/users/profile', data),
    changePassword: (data: { currentPassword: string; newPassword: string }) =>
        nodeApi.post<{ success: boolean; message: string }>('/users/change-password', data),
};

// ─── Reviews ─────────────────────────────────────────────────────────────────
export const reviewsApi = {
    byEquipment: (equipmentId: string) => nodeApi.get<{ reviews: unknown[] }>(`/reviews/machine/${equipmentId}`),
    create: (data: { bookingId: string; rating: number; reviewText?: string }) =>
        nodeApi.post<{ success: boolean; review: unknown }>('/reviews', data),
    delete: (id: string) => nodeApi.delete(`/reviews/${id}`),
};

// ─── Messages ─────────────────────────────────────────────────────────────────
export const messagesApi = {
    getThread: (bookingId: string) => nodeApi.get<{ messages: unknown[] }>(`/messages/${bookingId}`),
    send: (bookingId: string, content: string) =>
        nodeApi.post<{ success: boolean; message: unknown }>(`/messages/${bookingId}`, { content }),
    markRead: (bookingId: string) => nodeApi.patch(`/messages/${bookingId}/read`, {}),
};

// ─── Payment (Razorpay) ───────────────────────────────────────────────────────
export const razorpayApi = {
    createOrder: (data: { amount: number; currency?: string; receipt?: string; bookingId?: string }) =>
        request<{ orderId: string; amount: number; currency: string; keyId: string }>(
            typeof window !== 'undefined' ? '' : 'http://localhost:3000',
            '/api/payment/create-order',
            { method: 'POST', body: JSON.stringify(data) }
        ),
    verify: (data: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        request<{ success: boolean; paymentId: string }>(
            typeof window !== 'undefined' ? '' : 'http://localhost:3000',
            '/api/payment/verify',
            { method: 'POST', body: JSON.stringify(data) }
        ),
    refund: (bookingId: string, reason?: string) =>
        request<{ success: boolean; refundId: string }>(
            typeof window !== 'undefined' ? '' : 'http://localhost:3000',
            '/api/payment/refund',
            {
                method: 'POST',
                // Required by the payment API so a retried click cannot issue a second refund.
                headers: { 'Idempotency-Key': `refund-${bookingId}` },
                body: JSON.stringify({ bookingId, reason }),
            }
        ),
    refundStatus: (bookingId: string) =>
        request<{ refund?: unknown }>(
            typeof window !== 'undefined' ? '' : 'http://localhost:3000',
            `/api/payment/refund-status?bookingId=${bookingId}`,
            { method: 'GET' }
        ),
};

// ─── KYC ─────────────────────────────────────────────────────────────────────
export const kycApi = {
    getStatus: () => nodeApi.get<{ documents: Array<{ id: string; doc_type: string; status: string; rejection_reason?: string; file_url?: string; created_at: string }> }>('/kyc/status'),
    upload: (formData: FormData) => nodeApi.uploadForm<{ success: boolean; document: unknown }>('/kyc/upload', formData),
    adminList: () => nodeApi.get<{ documents: unknown[] }>('/kyc/admin'),
    approve: (id: string) => nodeApi.patch(`/kyc/admin/${id}/approve`, {}),
    reject: (id: string, reason: string) => nodeApi.patch(`/kyc/admin/${id}/reject`, { reason }),
};

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputesApi = {
    create: (data: { bookingId: string; type: string; description: string; evidenceUrls?: string[] }) =>
        nodeApi.post<{ success: boolean; dispute: unknown }>('/disputes', data),
    myDisputes: () => nodeApi.get<{ disputes: unknown[] }>('/disputes/my'),
    adminList: () => nodeApi.get<{ disputes: unknown[] }>('/disputes/admin'),
    resolve: (id: string, data: { status: string; admin_notes?: string }) =>
        nodeApi.patch(`/disputes/admin/${id}`, data),
};

// ─── Invoices ─────────────────────────────────────────────────────────────────
export const invoicesApi = {
    download: async (bookingId: string): Promise<void> => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const res = await fetch(`/api/v1/invoices/${bookingId}`, {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('Invoice download failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `farmrent-invoice-${bookingId.slice(0, 8)}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    },
};

// Favorites / Wishlist
export const favoritesApi = {
    getIds:  () => nodeApi.get<{ ids: string[] }>('/favorites/ids'),
    getAll:  () => nodeApi.get<{ data: unknown[] }>('/favorites'),
    add:     (equipmentId: string) => nodeApi.post(`/favorites/${equipmentId}`, {}),
    remove:  (equipmentId: string) => nodeApi.delete(`/favorites/${equipmentId}`),
    toggle:  async (equipmentId: string, isFav: boolean) =>
        isFav ? nodeApi.delete(`/favorites/${equipmentId}`) : nodeApi.post(`/favorites/${equipmentId}`, {}),
};

// Offers and Negotiations
export const offersApi = {
    create: (data: { equipment_id: string; offered_price_per_day: number; start_date: string; end_date: string; message?: string }) =>
        nodeApi.post('/offers', data),
    mySent:   () => nodeApi.get<{ data: unknown[] }>('/offers/my'),
    received: () => nodeApi.get<{ data: unknown[] }>('/offers/received'),
    respond:  (id: string, action: 'accept' | 'reject' | 'counter', counterPrice?: number) =>
        nodeApi.patch(`/offers/${id}/respond`, { action, counter_price: counterPrice }),
};

// Saved Searches
export const savedSearchesApi = {
    getAll:  () => nodeApi.get<{ data: unknown[] }>('/saved-searches'),
    create:  (data: { name: string; filters: Record<string, unknown>; alert_on?: boolean }) =>
        nodeApi.post('/saved-searches', data),
    delete:  (id: string) => nodeApi.delete(`/saved-searches/${id}`),
    toggleAlert: (id: string, alert_on: boolean) => nodeApi.patch(`/saved-searches/${id}`, { alert_on }),
};

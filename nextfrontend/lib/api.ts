/**
 * api.ts — Central API client for FarmRent (Next.js)
 *
 * With `npm run dev` / `npm start` (unified server), API is same-origin (port 3000).
 * Set NEXT_PUBLIC_API_URL if the API is on another host/port.
 * Node proxies /api/v2/* → Flask when Flask is running.
 */

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
const getToken = (): string | null =>
    typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

const authHeaders = (): Record<string, string> => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
};

// ─── Token refresh (deduped to avoid refresh storms on simultaneous 401s) ────
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = fetch('/api/v1/auth/refresh', {
        method: 'POST',
        credentials: 'include',
    }).then(async r => {
        if (!r.ok) return null;
        const d = await r.json();
        if (d.token) {
            localStorage.setItem('authToken', d.token);
            return d.token as string;
        }
        return null;
    }).catch(() => null).finally(() => { refreshPromise = null; });
    return refreshPromise;
}

function clearSession() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('authToken');
    document.cookie = 'authRole=; path=/; SameSite=Lax; max-age=0';
    window.location.href = '/login?reason=session_expired';
}

// ─── Base fetch wrapper ───────────────────────────────────────────────────────
async function request<T>(
    base: string,
    path: string,
    options: RequestInit = {},
    _isRetry = false
): Promise<T> {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

    let res: Response;
    try {
        res = await fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
                ...(options.headers as Record<string, string> ?? {}),
            },
        });
    } catch (e) {
        const hint =
            typeof window !== 'undefined' && url.includes('localhost:5000')
                ? ' API is configured for port 5000 but nothing is listening — use unified dev on :3000 or set NEXT_PUBLIC_API_URL in .env.local.'
                : ' Check that the dev server is running and NEXT_PUBLIC_API_URL matches the API port.';
        const msg = e instanceof Error ? e.message : 'Network error';
        throw new Error(`${msg}.${hint}`);
    }

    // ── 401 → attempt silent token refresh, retry once ────────────────────────
    if (res.status === 401 && !_isRetry) {
        const newToken = await refreshAccessToken();
        if (newToken) {
            return request<T>(base, path, options, true);
        }
        clearSession();
        throw new Error('Session expired. Please log in again.');
    }

    if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            errorMsg = body.message ?? body.error ?? errorMsg;
        } catch { /* ignore */ }
        throw new Error(errorMsg);
    }

    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
}

// ─── Node.js API client (/api/v1) ─────────────────────────────────────────────
export const nodeApi = {
    get: <T>(path: string) => request<T>(getNodeApiBase(), path, { method: 'GET' }),
    post: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'POST', body: JSON.stringify(body) }),
    put: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'PUT', body: JSON.stringify(body) }),
    patch: <T>(path: string, body: unknown) => request<T>(getNodeApiBase(), path, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: <T>(path: string) => request<T>(getNodeApiBase(), path, { method: 'DELETE' }),
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
    logout: () => { if (typeof window !== 'undefined') localStorage.removeItem('authToken'); },
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
export const payments = {
    initiate:  (data: unknown) => nodeApi.post('/payments/initiate', data),
    confirm:   (data: unknown) => nodeApi.post('/payments/confirm', data),
    refund:    (data: unknown) => nodeApi.post('/payments/refund', data),
    validateCard: (data: unknown) => nodeApi.post('/payments/validate-card', data),
    // Legacy Flask-proxied helpers kept for backwards compat
    createPayment: (data: unknown) => flaskApi.post('/payments/create', data),
    createSubscription: (data: unknown) => flaskApi.post('/payments/subscribe', data),
};

// ─── Admin API ────────────────────────────────────────────────────────────────
export const adminApi = {
    getDashboard: () => nodeApi.get<{ success: boolean; data: Record<string, unknown> }>('/admin/dashboard'),
    getMachines:  () => nodeApi.get<{ success: boolean; data: unknown[] }>('/admin/machines'),
    approveMachine: (id: string) => nodeApi.patch(`/admin/machines/${id}/approve`, {}),
    getUsers: () => nodeApi.get<{ success: boolean; data: unknown[] }>('/admin/users'),
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
            { method: 'POST', body: JSON.stringify({ bookingId, reason }) }
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
    getStatus: () => nodeApi.get<{ documents: unknown[] }>('/kyc/status'),
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

'use client';

/**
 * AuthContext.tsx — Global auth state for Next.js (App Router)
 * Provides useAuth() hook to all client components.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { hasSessionHint, nodeApi } from '@/lib/api';

interface User {
    id: string;
    name: string;
    email: string;
    role: 'farmer' | 'owner' | 'admin';
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ role: string }>;
    loginWithToken: (token: string, user: User) => void;
    register: (data: RegisterData) => Promise<{ role: string }>;
    logout: () => Promise<void>;
    switchRole: (newRole: 'farmer' | 'owner') => Promise<{ role: string }>;
    updateUser: (updatedUser: Partial<User>) => void;
    isAuthenticated: boolean;
}

interface RegisterData {
    name: string;
    email: string;
    password: string;
    role: 'farmer' | 'owner';
    phone?: string;
    pincode?: string;
    village?: string;
    district?: string;
    state?: string;
}

const AUTH_ROLE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days — matches refresh token lifetime

function writeAuthRoleCookie(role: string) {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `authRole=${role}; path=/; SameSite=Lax; max-age=${AUTH_ROLE_MAX_AGE}${secure}`;
}

function clearAuthRoleCookie() {
    document.cookie = 'authRole=; path=/; SameSite=Lax; max-age=0';
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Signed-out visitors carry no session cookie: skip the /auth/me round-trip and its 401.
        if (!hasSessionHint()) {
            setIsLoading(false);
            return;
        }
        nodeApi.get<{ success: boolean; user: User }>('/auth/me')
            .then((res) => {
                setUser(res.user);
                setToken('session-cookie');
                writeAuthRoleCookie(res.user.role);
            })
            .catch(() => {
                clearAuthRoleCookie();
                setToken(null);
                setUser(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = async (email: string, password: string) => {
        const res = await nodeApi.post<{ success: boolean; token: string; user: User }>(
            '/auth/login', { email, password }
        );
        setToken(res.token);
        setUser(res.user);
        writeAuthRoleCookie(res.user.role);
        return { role: res.user.role };
    };

    const loginWithToken = (tok: string, u: User) => {
        setToken(tok);
        setUser(u);
        writeAuthRoleCookie(u.role);
    };

    const register = async (data: RegisterData) => {
        const res = await nodeApi.post<{ success: boolean; token: string; user: User }>(
            '/auth/register', data
        );
        setToken(res.token);
        setUser(res.user);
        writeAuthRoleCookie(res.user.role);
        return { role: res.user.role };
    };

    const updateUser = (updatedUser: Partial<User>) => {
        setUser(prev => prev ? { ...prev, ...updatedUser } : null);
        if (updatedUser.role) {
            writeAuthRoleCookie(updatedUser.role);
        }
    };

    const switchRole = async (newRole: 'farmer' | 'owner') => {
        // Optimistic UI update — immediately update client state & authRole cookie
        setUser(prev => prev ? { ...prev, role: newRole } : null);
        writeAuthRoleCookie(newRole);

        try {
            const res = await nodeApi.patch<{ success: boolean; user: User }>(
                '/users/profile',
                { role: newRole }
            );
            if (res?.user) {
                setUser(res.user);
                writeAuthRoleCookie(res.user.role);
                return { role: res.user.role };
            }
        } catch (err) {
            console.warn('[switchRole] Backend profile update fallback (optimistic role active):', err);
        }
        return { role: newRole };
    };

    const logout = async () => {
        try {
            await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
        } catch { /* best-effort — ignore network errors */ }
        clearAuthRoleCookie();
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isLoading,
            login,
            loginWithToken,
            register,
            logout,
            switchRole,
            updateUser,
            isAuthenticated: !!user
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}

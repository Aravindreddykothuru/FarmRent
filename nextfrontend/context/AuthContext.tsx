'use client';

/**
 * AuthContext.tsx — Global auth state for Next.js (App Router)
 * Provides useAuth() hook to all client components.
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { nodeApi } from '@/lib/api';

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
    document.cookie = `authRole=${role}; path=/; SameSite=Strict; max-age=${AUTH_ROLE_MAX_AGE}${secure}`;
}

function clearAuthRoleCookie() {
    document.cookie = 'authRole=; path=/; SameSite=Strict; max-age=0';
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const savedToken = localStorage.getItem('authToken');
        if (!savedToken) { setIsLoading(false); return; }
        setToken(savedToken);
        nodeApi.get<{ success: boolean; user: User }>('/auth/me')
            .then((res) => {
                setUser(res.user);
                writeAuthRoleCookie(res.user.role);
            })
            .catch(() => {
                localStorage.removeItem('authToken');
                clearAuthRoleCookie();
                setToken(null);
            })
            .finally(() => setIsLoading(false));
    }, []);

    const login = async (email: string, password: string) => {
        const res = await nodeApi.post<{ success: boolean; token: string; user: User }>(
            '/auth/login', { email, password }
        );
        localStorage.setItem('authToken', res.token);
        setToken(res.token);
        setUser(res.user);
        writeAuthRoleCookie(res.user.role);
        return { role: res.user.role };
    };

    const loginWithToken = (tok: string, u: User) => {
        localStorage.setItem('authToken', tok);
        setToken(tok);
        setUser(u);
        writeAuthRoleCookie(u.role);
    };

    const register = async (data: RegisterData) => {
        const res = await nodeApi.post<{ success: boolean; token: string; user: User }>(
            '/auth/register', data
        );
        localStorage.setItem('authToken', res.token);
        setToken(res.token);
        setUser(res.user);
        writeAuthRoleCookie(res.user.role);
        return { role: res.user.role };
    };

    const logout = async () => {
        try {
            await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
        } catch { /* best-effort — ignore network errors */ }
        localStorage.removeItem('authToken');
        clearAuthRoleCookie();
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, loginWithToken, register, logout, isAuthenticated: !!user }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
    return ctx;
}

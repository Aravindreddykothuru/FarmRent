'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';

function passwordStrength(p: string): { score: number; label: string; color: string } {
    let score = 0;
    if (p.length >= 8)           score++;
    if (/[A-Z]/.test(p))         score++;
    if (/[0-9]/.test(p))         score++;
    if (/[^A-Za-z0-9]/.test(p))  score++;
    const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-400', 'bg-green-500'];
    return { score, label: labels[score] || '', color: colors[score] || '' };
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
                <Loader2 className="w-8 h-8 animate-spin text-green-700" />
            </div>
        }>
            <ResetPasswordInner />
        </Suspense>
    );
}

function ResetPasswordInner() {
    const searchParams = useSearchParams();
    const router       = useRouter();
    const token        = searchParams.get('token');

    const [password,  setPassword]  = useState('');
    const [confirm,   setConfirm]   = useState('');
    const [showPass,  setShowPass]  = useState(false);
    const [busy,      setBusy]      = useState(false);
    const [done,      setDone]      = useState(false);
    const [error,     setError]     = useState('');

    const strength = passwordStrength(password);
    const mismatch = confirm.length > 0 && password !== confirm;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!token) { setError('Invalid reset link.'); return; }
        if (strength.score < 3) { setError('Password is too weak. Use at least 8 chars, a number, and a special character.'); return; }
        if (password !== confirm) { setError('Passwords do not match.'); return; }

        setBusy(true);
        try {
            await nodeApi.post('/auth/reset-password', { token, password });
            setDone(true);
            toast.success('Password updated successfully!');
            setTimeout(() => router.push('/login'), 2000);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Reset failed. The link may have expired.');
        } finally {
            setBusy(false);
        }
    };

    if (!token) return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full text-center">
                <p className="text-red-500 font-semibold mb-4">Invalid or missing reset token.</p>
                <Link href="/forgot-password">
                    <Button className="bg-green-700 hover:bg-green-800 rounded-xl font-bold">Request New Link</Button>
                </Link>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full">

                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
                    <ArrowLeft className="w-4 h-4" /> Back to Login
                </Link>

                {!done ? (
                    <>
                        <div className="mb-6">
                            <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center mb-4">
                                <Lock className="w-6 h-6 text-green-700" />
                            </div>
                            <h1 className="text-2xl font-black text-gray-900">Set New Password</h1>
                            <p className="text-gray-500 text-sm mt-1">Choose a strong password for your account.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* New password */}
                            <div>
                                <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    New Password
                                </label>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPass ? 'text' : 'password'}
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                    <button type="button" onClick={() => setShowPass(v => !v)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                                {password.length > 0 && (
                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                            <div className={`h-full rounded-full transition-all ${strength.color} ${
                                                ['w-0','w-1/4','w-1/2','w-3/4','w-full'][strength.score]
                                            }`} />
                                        </div>
                                        <span className={`text-xs font-medium ${
                                            strength.score <= 1 ? 'text-red-500' :
                                            strength.score === 2 ? 'text-amber-500' :
                                            strength.score === 3 ? 'text-blue-500' : 'text-green-600'
                                        }`}>{strength.label}</span>
                                    </div>
                                )}
                            </div>

                            {/* Confirm password */}
                            <div>
                                <label htmlFor="confirm" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    Confirm Password
                                </label>
                                <input
                                    id="confirm"
                                    type={showPass ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    value={confirm}
                                    onChange={e => setConfirm(e.target.value)}
                                    className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${
                                        mismatch ? 'border-red-300' : 'border-gray-200'
                                    }`}
                                />
                                {mismatch && <p className="mt-1 text-xs text-red-500">Passwords do not match</p>}
                            </div>

                            {error && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">
                                    {error}
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={busy || !password || !confirm || mismatch}
                                className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl h-11"
                            >
                                {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Resetting…</> : 'Reset Password'}
                            </Button>
                        </form>
                    </>
                ) : (
                    <div className="text-center py-4">
                        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
                        <h1 className="text-xl font-bold text-gray-900 mb-2">Password Reset!</h1>
                        <p className="text-gray-500 text-sm mb-6">
                            Your password has been updated. All other sessions have been logged out for security.
                        </p>
                        <Button
                            className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl"
                            onClick={() => router.push('/login')}
                        >
                            Log In with New Password
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nodeApi } from '@/lib/api';

type State = 'loading' | 'success' | 'error' | 'no-token';

export default function VerifyEmailPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
                <Loader2 className="w-8 h-8 animate-spin text-green-700" />
            </div>
        }>
            <VerifyEmailInner />
        </Suspense>
    );
}

function VerifyEmailInner() {
    const searchParams = useSearchParams();
    const router       = useRouter();
    const token        = searchParams.get('token');

    const [state,   setState]   = useState<State>(token ? 'loading' : 'no-token');
    const [message, setMessage] = useState('');
    const [resendEmail, setResendEmail] = useState('');
    const [resendSent,  setResendSent]  = useState(false);
    const [resendBusy,  setResendBusy]  = useState(false);

    useEffect(() => {
        if (!token) return;
        nodeApi.post('/auth/verify-email', { token })
            .then(() => { setState('success'); setMessage('Your email has been verified! You can now log in.'); })
            .catch((e: unknown) => {
                setState('error');
                setMessage(e instanceof Error ? e.message : 'Verification failed. The link may have expired.');
            });
    }, [token]);

    const handleResend = async () => {
        if (!resendEmail || resendBusy) return;
        setResendBusy(true);
        try {
            await nodeApi.post('/auth/resend-verification', { email: resendEmail });
            setResendSent(true);
        } catch { /* always show success to prevent enumeration */ setResendSent(true); }
        finally   { setResendBusy(false); }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full text-center">

                {state === 'loading' && (
                    <>
                        <Loader2 className="w-12 h-12 text-green-600 mx-auto mb-4 animate-spin" />
                        <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email…</h1>
                        <p className="text-gray-500 text-sm">Please wait a moment.</p>
                    </>
                )}

                {state === 'success' && (
                    <>
                        <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
                        <h1 className="text-xl font-bold text-gray-900 mb-2">Email Verified!</h1>
                        <p className="text-gray-500 text-sm mb-6">{message}</p>
                        <Button
                            className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl"
                            onClick={() => router.push('/login')}
                        >
                            Go to Login
                        </Button>
                    </>
                )}

                {(state === 'error' || state === 'no-token') && (
                    <>
                        <XCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
                        <h1 className="text-xl font-bold text-gray-900 mb-2">
                            {state === 'no-token' ? 'Invalid Link' : 'Verification Failed'}
                        </h1>
                        <p className="text-gray-500 text-sm mb-6">
                            {state === 'no-token'
                                ? 'This verification link is invalid.'
                                : message}
                        </p>

                        {!resendSent ? (
                            <div className="space-y-3">
                                <p className="text-sm text-gray-600 font-medium">Request a new verification link:</p>
                                <input
                                    type="email"
                                    placeholder="your@email.com"
                                    value={resendEmail}
                                    onChange={e => setResendEmail(e.target.value)}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                                <Button
                                    className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl"
                                    onClick={handleResend}
                                    disabled={!resendEmail || resendBusy}
                                >
                                    {resendBusy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MailCheck className="w-4 h-4 mr-2" />}
                                    Resend Verification Email
                                </Button>
                            </div>
                        ) : (
                            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                <MailCheck className="w-6 h-6 text-green-600 mx-auto mb-2" />
                                <p className="text-green-700 text-sm font-medium">
                                    If that email is registered and unverified, a new link has been sent. Check your inbox.
                                </p>
                            </div>
                        )}

                        <Link href="/login" className="block mt-4 text-sm text-green-700 hover:underline">
                            Back to Login
                        </Link>
                    </>
                )}
            </div>
        </div>
    );
}

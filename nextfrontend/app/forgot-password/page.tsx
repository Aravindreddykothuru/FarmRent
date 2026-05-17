'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
    Mail, Phone, ArrowLeft, Loader2, MailCheck, KeyRound,
    AlertCircle, CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nodeApi } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

type Mode  = 'email' | 'phone';
type Stage = 'form' | 'sent';

export default function ForgotPasswordPage() {
    const { t } = useLanguage();
    const [mode,  setMode]  = useState<Mode>('email');
    const [stage, setStage] = useState<Stage>('form');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [busy,  setBusy]  = useState(false);
    const [error, setError] = useState('');

    const isEmail = mode === 'email';

    const switchMode = (m: Mode) => {
        if (m === mode) return;
        setMode(m);
        setError('');
    };

    const handlePhoneInput = (raw: string) => {
        setPhone(raw.replace(/\D/g, '').slice(0, 10));
        setError('');
    };

    const validate = (): string => {
        if (isEmail) {
            if (!email.trim()) return t('validation.required');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
                return t('validation.invalidEmail');
        } else {
            if (!phone) return t('validation.required');
            if (!/^[6-9]\d{9}$/.test(phone))
                return t('validation.invalidPhone');
        }
        return '';
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        const ve = validate();
        if (ve) { setError(ve); return; }

        setBusy(true);
        setError('');

        try {
            const body = isEmail
                ? { email: email.trim().toLowerCase() }
                : { phone };
            await nodeApi.post('/auth/forgot-password', body);
            setStage('sent');
        } catch (err: unknown) {
            if (!isEmail && err instanceof Error && err.message.includes('No account')) {
                setError(t('forgotPassword.noAccountPhone'));
                return;
            }
            if (isEmail) {
                setStage('sent');
            } else {
                setError(t('common.error'));
            }
        } finally {
            setBusy(false);
        }
    };

    const phoneValid = /^[6-9]\d{9}$/.test(phone);
    const canSubmit  = isEmail ? email.trim().length > 0 : phone.length > 0;

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-4 py-10">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full">

                <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-7 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" /> {t('forgotPassword.backToLogin')}
                </Link>

                {stage === 'form' ? (
                    <>
                        {/* ── Header ─────────────────────────────────────────── */}
                        <div className="mb-7">
                            <div className="w-14 h-14 bg-green-50 rounded-2xl flex items-center justify-center mb-5">
                                <KeyRound className="w-7 h-7 text-green-700" />
                            </div>
                            <h1 className="text-2xl font-black text-gray-900 mb-2">{t('forgotPassword.title')}</h1>
                            <p className="text-gray-500 text-sm leading-relaxed">
                                {t('forgotPassword.subtitle')}
                            </p>
                        </div>

                        {/* ── Mode toggle ────────────────────────────────────── */}
                        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-6">
                            <button
                                type="button"
                                onClick={() => switchMode('email')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-150 ${
                                    isEmail
                                        ? 'bg-white text-green-700 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <Mail className="w-4 h-4 shrink-0" />
                                {t('forgotPassword.emailTab')}
                            </button>
                            <button
                                type="button"
                                onClick={() => switchMode('phone')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all duration-150 ${
                                    !isEmail
                                        ? 'bg-white text-green-700 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                <Phone className="w-4 h-4 shrink-0" />
                                {t('forgotPassword.phoneTab')}
                            </button>
                        </div>

                        {/* ── Form ───────────────────────────────────────────── */}
                        <form onSubmit={handleSubmit} className="space-y-5" noValidate>

                            {isEmail ? (
                                <div>
                                    <label htmlFor="fp-email" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        {t('forgotPassword.emailLabel')}
                                    </label>
                                    <input
                                        id="fp-email"
                                        type="email"
                                        autoComplete="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={e => { setEmail(e.target.value); setError(''); }}
                                        className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 transition-colors ${
                                            error ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
                                        }`}
                                    />
                                </div>
                            ) : (
                                <div>
                                    <label htmlFor="fp-phone" className="block text-sm font-semibold text-gray-700 mb-1.5">
                                        {t('forgotPassword.phoneLabel')}
                                    </label>
                                    <div className={`flex items-center border rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-green-500 transition-all ${
                                        error ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
                                    }`}>
                                        <div className="flex items-center gap-1.5 px-3 py-3 bg-gray-50 border-r border-gray-200 shrink-0 select-none">
                                            <span className="text-base leading-none">🇮🇳</span>
                                            <span className="text-sm font-semibold text-gray-600">+91</span>
                                        </div>
                                        <input
                                            id="fp-phone"
                                            type="tel"
                                            inputMode="numeric"
                                            autoComplete="tel-national"
                                            placeholder="98765 43210"
                                            value={phone}
                                            onChange={e => handlePhoneInput(e.target.value)}
                                            className="flex-1 px-3 py-3 text-sm focus:outline-none bg-transparent"
                                            maxLength={10}
                                        />
                                        {phoneValid && (
                                            <div className="pr-3">
                                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                                            </div>
                                        )}
                                    </div>
                                    <p className="mt-1.5 text-xs text-gray-400">
                                        {t('forgotPassword.phoneTip')}
                                    </p>
                                </div>
                            )}

                            {/* Error banner */}
                            {error && (
                                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl p-3.5">
                                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                                    <p className="text-sm text-red-600 leading-snug">{error}</p>
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={busy || !canSubmit}
                                className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl h-12 text-base mt-1"
                            >
                                {busy ? (
                                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />{t('forgotPassword.sending')}</>
                                ) : (
                                    t('forgotPassword.sendLink')
                                )}
                            </Button>
                        </form>

                        <p className="text-center text-xs text-gray-400 mt-5">
                            {t('forgotPassword.rememberPassword')}{' '}
                            <Link href="/login" className="text-green-700 font-medium hover:underline">
                                {t('forgotPassword.signIn')}
                            </Link>
                        </p>
                    </>
                ) : (
                    /* ── Success state ─────────────────────────────────────── */
                    <div className="text-center py-2">
                        <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
                            <MailCheck className="w-10 h-10 text-green-500" />
                        </div>
                        <h1 className="text-2xl font-black text-gray-900 mb-2">
                            {isEmail ? t('forgotPassword.checkEmail') : t('forgotPassword.resetLinkSent')}
                        </h1>
                        <p className="text-gray-500 text-sm leading-relaxed mb-4">
                            {isEmail ? t('forgotPassword.emailSentDesc') : t('forgotPassword.phoneSentDesc')}
                        </p>

                        {/* Tips box */}
                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-left mb-5">
                            <p className="text-xs font-semibold text-amber-700 mb-2">
                                {t('forgotPassword.notReceived')}
                            </p>
                            <ul className="text-xs text-amber-600 space-y-1 list-disc list-inside">
                                {isEmail && <li>{t('forgotPassword.checkSpam')}</li>}
                                {!isEmail && <li>{t('forgotPassword.smsTip')}</li>}
                                <li>{t('forgotPassword.linkExpiry')}</li>
                                <li>{isEmail ? t('forgotPassword.checkCorrectEmail') : t('forgotPassword.checkCorrectPhone')}</li>
                            </ul>
                        </div>

                        <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => { setStage('form'); setError(''); }}
                                className="w-full text-sm text-green-700 hover:underline font-medium py-2 transition-colors"
                            >
                                {t('forgotPassword.tryAgain')}
                            </button>
                            <Link href="/login" className="block">
                                <Button variant="outline" className="w-full rounded-xl font-semibold h-11">
                                    {t('forgotPassword.backToLogin')}
                                </Button>
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

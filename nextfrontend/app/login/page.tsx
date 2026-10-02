'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tractor, Loader2, Eye, EyeOff, Shield, Zap, Star, Mail, Lock, AlertCircle, Smartphone, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageQuickBar, NeedHelpButton } from '@/components/AuthAssist';
import { OtpInput, PhoneField, usePhoneOtp, isIndianMobile, OTP_LENGTH } from '@/components/PhoneOtp';
const loginSchema = z.object({
    email:    z.string().email({ message: 'Enter a valid email address' }),
    password: z.string().min(1, { message: 'Password is required' }),
});
type LoginFormValues = z.infer<typeof loginSchema>;

function isSafeRedirect(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//') && !path.includes(':');
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { login, loginWithToken } = useAuth();
    const { t } = useLanguage();
    const [showPass, setShowPass] = useState(false);

    // Two ways in, side by side: the password this screen has always taken, and a code by SMS.
    const [mode, setMode] = useState<'password' | 'otp'>('password');
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const otpFlow = usePhoneOtp('login');

    const goAfterLogin = (role: string) => {
        const next = searchParams.get('next') ?? '';
        if (next && isSafeRedirect(next)) { router.push(next); return; }
        if (role === 'owner') router.push('/dashboard/owner');
        else if (role === 'admin') router.push('/dashboard/admin');
        else router.push('/dashboard/farmer');
    };

    const submitOtp = async (code: string) => {
        const result = await otpFlow.verify<{ token: string; user: { role: string } }>(phone, code);
        if (!result) { setOtp(''); return; }
        loginWithToken(result.token, result.user as never);
        toast.success(t('auth.loginSuccess'));
        goAfterLogin(result.user.role);
    };

    const FEATURES = [
        { icon: Tractor, text: t('auth.feature1') },
        { icon: Zap,     text: t('auth.feature2') },
        { icon: Shield,  text: t('auth.feature3') },
        { icon: Star,    text: t('auth.feature4') },
    ];

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (data: LoginFormValues) => {
        try {
            const { role } = await login(data.email, data.password);
            toast.success(t('auth.loginSuccess'));
            goAfterLogin(role);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('auth.loginFailed'));
        }
    };

    return (
        /*
         * Split hero and frosted glass card, after the "glassy" Form 2 mock.
         *
         * Two deliberate departures from that mock. The backdrop is a CSS gradient rather than the 1.1MB
         * photograph it shipped with, because this screen is reached over rural 3G. And every control keeps
         * the 48px / 16px floor the rest of the auth flow uses, which the mock's 13–14px text did not.
         */
        <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-900">

            {/* Depth, at no download cost */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-32 -right-24 h-[28rem] w-[28rem] rounded-full bg-yellow-400/10 blur-3xl" />
                <div className="absolute top-1/3 -left-32 h-[26rem] w-[26rem] rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="absolute -bottom-40 right-1/4 h-[22rem] w-[22rem] rounded-full bg-lime-300/10 blur-3xl" />
                <div className="absolute left-8 top-16 hidden h-56 w-56 rounded-full border-4 border-white/10 lg:block" />
                <div className="absolute bottom-24 left-1/3 hidden h-32 w-32 rounded-full border-4 border-white/10 lg:block" />
            </div>

            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center gap-10 px-4 py-10 lg:flex-row lg:justify-between lg:gap-16 lg:px-12">

                {/* ── Hero ─────────────────────────────────────────────── */}
                <div className="w-full max-w-xl text-center lg:text-left">
                    <Link href="/" className="inline-flex items-center gap-2.5">
                        <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur">
                            <Tractor className="h-7 w-7 text-white" />
                        </div>
                        <span className="text-3xl font-black text-white">FarmRent</span>
                    </Link>

                    <h1 className="mt-6 text-5xl font-black leading-[1.05] text-white sm:text-6xl lg:text-7xl">
                        {t('auth.welcomeBack')}
                    </h1>
                    <p className="mt-4 text-lg text-green-100/90 lg:text-xl">
                        {t('auth.signInSubtitle')}
                    </p>

                    {/* The feature list is desktop-only: on a phone it would push the form below the fold. */}
                    <ul className="mt-8 hidden space-y-3 lg:block">
                        {FEATURES.map(f => (
                            <li key={f.text} className="flex items-center gap-3">
                                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10 backdrop-blur">
                                    <f.icon className="h-5 w-5 text-green-200" />
                                </div>
                                <span className="text-base text-green-100">{f.text}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ── Glass card ───────────────────────────────────────── */}
                <div
                    className="w-full max-w-md rounded-3xl border border-white/15 bg-green-950/40 p-5 backdrop-blur-2xl backdrop-saturate-150 sm:p-7"
                    style={{
                        boxShadow:
                            '0 35px 70px rgba(0,0,0,0.45), inset 0 1.5px 2px rgba(255,255,255,0.22), inset 0 -1px 2px rgba(0,0,0,0.3)',
                    }}
                >
                    {/* Language — kept at the top, since a farmer who cannot read this page
                        needs to switch before anything else on it makes sense. */}
                    <LanguageQuickBar next="/login" tone="dark" />

                    {/* Two ways in, shown side by side rather than one hidden behind a link. */}
                    <div className="grid grid-cols-2 gap-2 mb-6" role="tablist" aria-label={t('auth.signIn')}>
                        <button
                            type="button" role="tab" suppressHydrationWarning
                            aria-selected={mode === 'password'}
                            onClick={() => setMode('password')}
                            className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition-colors ${
                                mode === 'password'
                                    ? 'border-green-400 bg-green-600 text-white shadow-lg shadow-green-900/50'
                                    : 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
                            }`}
                        >
                            <KeyRound className="h-5 w-5" aria-hidden="true" />
                            {t('auth.password')}
                        </button>
                        <button
                            type="button" role="tab" suppressHydrationWarning
                            aria-selected={mode === 'otp'}
                            onClick={() => setMode('otp')}
                            className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition-colors ${
                                mode === 'otp'
                                    ? 'border-green-400 bg-green-600 text-white shadow-lg shadow-green-900/50'
                                    : 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
                            }`}
                        >
                            <Smartphone className="h-5 w-5" aria-hidden="true" />
                            {t('auth.loginWithOtp')}
                        </button>
                    </div>

                    {mode === 'otp' ? (
                        <div className="space-y-5">
                            <div>
                                <Label htmlFor="otp-phone" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-green-50">
                                    <Smartphone className="h-5 w-5 text-green-300" aria-hidden="true" />
                                    {t('auth.phone')}
                                </Label>
                                <PhoneField
                                    id="otp-phone"
                                    value={phone}
                                    onChange={v => { setPhone(v); otpFlow.reset(); setOtp(''); }}
                                    disabled={otpFlow.sent}
                                    invalid={phone.length > 0 && !isIndianMobile(phone)}
                                    tone="dark"
                                />
                                {phone.length > 0 && !isIndianMobile(phone) && (
                                    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-300">
                                        <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                        {t('auth.enterTenDigits')}
                                    </p>
                                )}
                            </div>

                            {otpFlow.sent && (
                                <div>
                                    <Label className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.enterOtp')}</Label>
                                    <OtpInput
                                        value={otp}
                                        onChange={setOtp}
                                        onComplete={submitOtp}
                                        disabled={otpFlow.verifying}
                                        invalid={!!otpFlow.error}
                                        autoFocus
                                        tone="dark"
                                    />
                                    {otpFlow.devOtp && (
                                        <p className="mt-2 text-sm text-yellow-300">Dev code: <strong>{otpFlow.devOtp}</strong></p>
                                    )}
                                </div>
                            )}

                            {otpFlow.error && (
                                <p className="flex items-center gap-1.5 text-sm text-red-300" role="alert">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {otpFlow.error}
                                </p>
                            )}

                            {!otpFlow.sent ? (
                                <Button
                                    type="button"
                                    onClick={() => otpFlow.send(phone)}
                                    disabled={!isIndianMobile(phone) || otpFlow.sending}
                                    className="h-14 w-full rounded-xl bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 text-lg font-bold text-white shadow-lg shadow-green-900/50 transition-all hover:brightness-110 hover:shadow-xl disabled:opacity-50"
                                >
                                    {otpFlow.sending && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                                    {t('auth.sendOtp')}
                                </Button>
                            ) : (
                                <>
                                    <Button
                                        type="button"
                                        onClick={() => submitOtp(otp)}
                                        disabled={otp.length !== OTP_LENGTH || otpFlow.verifying}
                                        className="h-14 w-full rounded-xl bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 text-lg font-bold text-white shadow-lg shadow-green-900/50 transition-all hover:brightness-110 hover:shadow-xl disabled:opacity-50"
                                    >
                                        {otpFlow.verifying && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                                        {t('auth.verify')}
                                    </Button>
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={() => { setOtp(''); otpFlow.send(phone); }}
                                        disabled={otpFlow.secondsLeft > 0 || otpFlow.sending}
                                        className="h-11 w-full text-base font-semibold text-green-200 hover:text-white hover:underline disabled:text-green-100/40 disabled:no-underline"
                                    >
                                        {otpFlow.secondsLeft > 0
                                            ? t('auth.resendIn', { seconds: otpFlow.secondsLeft })
                                            : t('auth.resendOtp')}
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        <div>
                            <Label htmlFor="email" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-green-50">
                                <Mail className="h-5 w-5 text-green-300" aria-hidden="true" />
                                {t('auth.email')}
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                inputMode="email"
                                autoComplete="email"
                                placeholder="you@example.com"
                                aria-invalid={!!errors.email}
                                {...register('email')}
                                className={`h-12 rounded-xl border-white/20 bg-white/10 text-base text-white placeholder:text-green-100/50 focus-visible:ring-green-300 ${errors.email ? 'border-red-400' : ''}`}
                            />
                            {errors.email && (
                                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-300">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {errors.email.message}
                                </p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="password" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-green-50">
                                <Lock className="h-5 w-5 text-green-300" aria-hidden="true" />
                                {t('auth.password')}
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPass ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    placeholder="Your password"
                                    aria-invalid={!!errors.password}
                                    {...register('password')}
                                    className={`h-12 rounded-xl border-white/20 bg-white/10 pr-14 text-base text-white placeholder:text-green-100/50 focus-visible:ring-green-300 ${errors.password ? 'border-red-400' : ''}`}
                                />
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    aria-label={showPass ? 'Hide password' : 'Show password'}
                                    onClick={() => setShowPass(v => !v)}
                                    className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-green-100/70 transition-colors hover:text-white"
                                >
                                    {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-300">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {errors.password.message}
                                </p>
                            )}
                            <Link
                                href="/forgot-password"
                                className="mt-2 inline-flex h-11 items-center text-base font-semibold text-green-200 hover:text-white hover:underline"
                            >
                                {t('auth.forgotPassword')}
                            </Link>
                        </div>

                        <Button
                            type="submit"
                            className="h-14 w-full rounded-xl bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 text-lg font-bold text-white shadow-lg shadow-green-900/50 transition-all hover:brightness-110 hover:shadow-xl"
                            disabled={isSubmitting}
                        >
                            {isSubmitting
                                ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />{t('auth.signingIn')}</>
                                : t('auth.signIn')}
                        </Button>
                    </form>
                    )}

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/15" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="rounded-full bg-green-950/60 px-3 text-base font-semibold text-green-100 backdrop-blur">{t('auth.noAccount')}</span>
                        </div>
                    </div>

                    {/* Register links — one column on a phone, so each card stays thumb-sized */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Link href="/register?role=farmer" className="block">
                            <span className="flex min-h-[64px] w-full items-center gap-3 border-2 border-white/20 bg-white/5 hover:border-green-300 hover:bg-white/10 rounded-xl px-4 py-3 transition-all group">
                                <span className="text-3xl" aria-hidden="true">👨‍🌾</span>
                                <span className="text-left">
                                    <span className="block text-base font-bold text-white">{t('auth.rentEquipment')}</span>
                                    <span className="block text-base text-green-100/80">{t('auth.registerFarmer')}</span>
                                </span>
                            </span>
                        </Link>
                        <Link href="/register?role=owner" className="block">
                            <span className="flex min-h-[64px] w-full items-center gap-3 border-2 border-white/20 bg-white/5 hover:border-green-300 hover:bg-white/10 rounded-xl px-4 py-3 transition-all group">
                                <span className="text-3xl" aria-hidden="true">🚜</span>
                                <span className="text-left">
                                    <span className="block text-base font-bold text-white">{t('auth.listEquipment')}</span>
                                    <span className="block text-base text-green-100/80">{t('auth.registerOwner')}</span>
                                </span>
                            </span>
                        </Link>
                    </div>

                    <NeedHelpButton tone="dark" />
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-950 via-green-900 to-emerald-900">
                <Loader2 className="h-8 w-8 animate-spin text-green-200" />
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}

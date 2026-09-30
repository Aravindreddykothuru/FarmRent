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
        <div className="min-h-screen flex overflow-x-hidden">

            {/* ── Left panel (hidden on mobile) ─────────────────────── */}
            <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-green-950 via-green-900 to-green-800 flex-col justify-between p-12 relative overflow-hidden">
                {/* Background blobs */}
                <div className="absolute top-0 right-0 w-80 h-80 bg-yellow-400/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-green-400/10 rounded-full blur-2xl pointer-events-none" />

                {/* Logo */}
                <Link href="/" className="flex items-center gap-2.5 relative z-10">
                    <div className="bg-white/10 backdrop-blur rounded-xl p-2.5">
                        <Tractor className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-2xl font-black text-white">FarmRent</span>
                </Link>

                {/* Body */}
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 bg-yellow-400/20 text-yellow-300 text-xs font-bold px-3 py-1.5 rounded-full mb-5">
                        🇮🇳 {t('auth.indiaTopMarket')}
                    </div>
                    <h2 className="text-4xl font-black text-white leading-tight mb-3">
                        {t('auth.rentSmarter')}<br />
                        <span className="text-yellow-400">{t('auth.farmBetter')}</span>
                    </h2>
                    <p className="text-green-200 text-base leading-relaxed mb-8">
                        {t('auth.signInAccess')}
                    </p>

                    {/* Feature list */}
                    <ul className="space-y-3">
                        {FEATURES.map(f => (
                            <li key={f.text} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                                    <f.icon className="h-4 w-4 text-green-300" />
                                </div>
                                <span className="text-green-100 text-sm">{f.text}</span>
                            </li>
                        ))}
                    </ul>
                </div>

            </div>

            {/* ── Right panel (form) ─────────────────────────────────── */}
            <div className="flex-1 flex items-center justify-center px-4 py-8 sm:px-5 sm:py-10 bg-white">
                <div className="w-full max-w-md">

                    {/* Mobile logo + tagline */}
                    <div className="mb-6 lg:hidden">
                        <Link href="/" className="flex items-center justify-center gap-2">
                            <div className="bg-green-700 rounded-xl p-2.5">
                                <Tractor className="h-7 w-7 text-white" />
                            </div>
                            <span className="text-3xl font-black text-green-700">FarmRent</span>
                        </Link>
                        <p className="mt-2 text-center text-base text-gray-700">{t('auth.signInSubtitle')}</p>
                    </div>

                    {/* Language — kept near the top, since a farmer who cannot read this page
                        needs to switch before anything else on it makes sense. */}
                    <LanguageQuickBar next="/login" />

                    <div className="mb-6">
                        <h1 className="text-3xl font-black text-gray-900">{t('auth.welcomeBack')}</h1>
                        <p className="hidden lg:block text-gray-600 mt-1 text-base">{t('auth.signInSubtitle')}</p>
                    </div>

                    {/* Two ways in, shown side by side rather than one hidden behind a link. */}
                    <div className="grid grid-cols-2 gap-2 mb-6" role="tablist" aria-label={t('auth.signIn')}>
                        <button
                            type="button" role="tab" suppressHydrationWarning
                            aria-selected={mode === 'password'}
                            onClick={() => setMode('password')}
                            className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition-colors ${
                                mode === 'password'
                                    ? 'border-green-700 bg-green-700 text-white'
                                    : 'border-gray-300 bg-white text-gray-800 hover:border-green-500'
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
                                    ? 'border-green-700 bg-green-700 text-white'
                                    : 'border-gray-300 bg-white text-gray-800 hover:border-green-500'
                            }`}
                        >
                            <Smartphone className="h-5 w-5" aria-hidden="true" />
                            {t('auth.loginWithOtp')}
                        </button>
                    </div>

                    {mode === 'otp' ? (
                        <div className="space-y-5">
                            <div>
                                <Label htmlFor="otp-phone" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-gray-800">
                                    <Smartphone className="h-5 w-5 text-green-700" aria-hidden="true" />
                                    {t('auth.phone')}
                                </Label>
                                <PhoneField
                                    id="otp-phone"
                                    value={phone}
                                    onChange={v => { setPhone(v); otpFlow.reset(); setOtp(''); }}
                                    disabled={otpFlow.sent}
                                    invalid={phone.length > 0 && !isIndianMobile(phone)}
                                />
                                {phone.length > 0 && !isIndianMobile(phone) && (
                                    <p className="text-red-600 text-sm mt-1.5 flex items-center gap-1.5">
                                        <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                        {t('auth.enterTenDigits')}
                                    </p>
                                )}
                            </div>

                            {otpFlow.sent && (
                                <div>
                                    <Label className="mb-1.5 block text-base font-semibold text-gray-800">{t('auth.enterOtp')}</Label>
                                    <OtpInput
                                        value={otp}
                                        onChange={setOtp}
                                        onComplete={submitOtp}
                                        disabled={otpFlow.verifying}
                                        invalid={!!otpFlow.error}
                                        autoFocus
                                    />
                                    {otpFlow.devOtp && (
                                        <p className="text-amber-700 text-sm mt-2">Dev code: <strong>{otpFlow.devOtp}</strong></p>
                                    )}
                                </div>
                            )}

                            {otpFlow.error && (
                                <p className="text-red-600 text-sm flex items-center gap-1.5" role="alert">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {otpFlow.error}
                                </p>
                            )}

                            {!otpFlow.sent ? (
                                <Button
                                    type="button"
                                    onClick={() => otpFlow.send(phone)}
                                    disabled={!isIndianMobile(phone) || otpFlow.sending}
                                    className="w-full h-14 bg-green-700 hover:bg-green-800 rounded-xl font-bold text-lg disabled:opacity-60"
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
                                        className="w-full h-14 bg-green-700 hover:bg-green-800 rounded-xl font-bold text-lg disabled:opacity-60"
                                    >
                                        {otpFlow.verifying && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                                        {t('auth.verify')}
                                    </Button>
                                    <button
                                        type="button"
                                        suppressHydrationWarning
                                        onClick={() => { setOtp(''); otpFlow.send(phone); }}
                                        disabled={otpFlow.secondsLeft > 0 || otpFlow.sending}
                                        className="w-full h-11 text-base font-semibold text-green-800 hover:underline disabled:text-gray-500 disabled:no-underline"
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
                            <Label htmlFor="email" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-gray-800">
                                <Mail className="h-5 w-5 text-green-700" aria-hidden="true" />
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
                                className={`h-12 rounded-xl text-base ${errors.email ? 'border-red-500 focus-visible:ring-red-500' : 'border-gray-300'}`}
                            />
                            {errors.email && (
                                <p className="text-red-600 text-sm mt-1.5 flex items-center gap-1.5">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {errors.email.message}
                                </p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="password" className="mb-1.5 flex items-center gap-2 text-base font-semibold text-gray-800">
                                <Lock className="h-5 w-5 text-green-700" aria-hidden="true" />
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
                                    className={`h-12 rounded-xl text-base pr-14 ${errors.password ? 'border-red-500 focus-visible:ring-red-500' : 'border-gray-300'}`}
                                />
                                <button
                                    type="button"
                                    suppressHydrationWarning
                                    aria-label={showPass ? 'Hide password' : 'Show password'}
                                    onClick={() => setShowPass(v => !v)}
                                    className="absolute right-0 top-0 h-12 w-12 flex items-center justify-center text-gray-500 hover:text-gray-800 transition-colors"
                                >
                                    {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {errors.password && (
                                <p className="text-red-600 text-sm mt-1.5 flex items-center gap-1.5">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                    {errors.password.message}
                                </p>
                            )}
                            <Link
                                href="/forgot-password"
                                className="mt-2 inline-flex h-11 items-center text-base font-semibold text-green-800 hover:underline"
                            >
                                {t('auth.forgotPassword')}
                            </Link>
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-14 bg-green-700 hover:bg-green-800 rounded-xl font-bold text-lg"
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
                            <div className="w-full border-t border-gray-100" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white px-3 text-base text-gray-600 font-semibold">{t('auth.noAccount')}</span>
                        </div>
                    </div>

                    {/* Register links — one column on a phone, so each card stays thumb-sized */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Link href="/register?role=farmer" className="block">
                            <span className="flex min-h-[64px] w-full items-center gap-3 border-2 border-gray-300 hover:border-green-500 hover:bg-green-50 rounded-xl px-4 py-3 transition-all group">
                                <span className="text-3xl" aria-hidden="true">👨‍🌾</span>
                                <span className="text-left">
                                    <span className="block text-base font-bold text-gray-800 group-hover:text-green-800">{t('auth.rentEquipment')}</span>
                                    <span className="block text-base text-gray-600">{t('auth.registerFarmer')}</span>
                                </span>
                            </span>
                        </Link>
                        <Link href="/register?role=owner" className="block">
                            <span className="flex min-h-[64px] w-full items-center gap-3 border-2 border-gray-300 hover:border-green-500 hover:bg-green-50 rounded-xl px-4 py-3 transition-all group">
                                <span className="text-3xl" aria-hidden="true">🚜</span>
                                <span className="text-left">
                                    <span className="block text-base font-bold text-gray-800 group-hover:text-green-800">{t('auth.listEquipment')}</span>
                                    <span className="block text-base text-gray-600">{t('auth.registerOwner')}</span>
                                </span>
                            </span>
                        </Link>
                    </div>

                    <NeedHelpButton />
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-white">
                <Loader2 className="h-8 w-8 animate-spin text-green-700" />
            </div>
        }>
            <LoginForm />
        </Suspense>
    );
}

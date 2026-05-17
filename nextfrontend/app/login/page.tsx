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
import { Tractor, Loader2, Eye, EyeOff, Shield, Zap, Star, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
const loginSchema = z.object({
    email:    z.string().email({ message: 'Enter a valid email address' }),
    password: z.string().min(1, { message: 'Password is required' }),
});
type LoginForm = z.infer<typeof loginSchema>;

function isSafeRedirect(path: string): boolean {
    return path.startsWith('/') && !path.startsWith('//') && !path.includes(':');
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { login } = useAuth();
    const { t, currentLanguage } = useLanguage();
    const [showPass, setShowPass] = useState(false);

    const FEATURES = [
        { icon: Tractor, text: t('auth.feature1') },
        { icon: Zap,     text: t('auth.feature2') },
        { icon: Shield,  text: t('auth.feature3') },
        { icon: Star,    text: t('auth.feature4') },
    ];

    const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
        resolver: zodResolver(loginSchema),
    });

    const onSubmit = async (data: LoginForm) => {
        try {
            const { role } = await login(data.email, data.password);
            toast.success(t('auth.loginSuccess'));
            const next = searchParams.get('next') ?? '';
            if (next && isSafeRedirect(next)) { router.push(next); return; }
            if (role === 'owner') router.push('/dashboard/owner');
            else if (role === 'admin') router.push('/dashboard/admin');
            else router.push('/dashboard/farmer');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('auth.loginFailed'));
        }
    };

    return (
        <div className="min-h-screen flex">

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
                        Farm <span className="text-yellow-400">{t('auth.farmBetter')}</span>
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
            <div className="flex-1 flex items-center justify-center px-5 py-10 bg-white">
                <div className="w-full max-w-md">

                    {/* Mobile logo */}
                    <div className="flex justify-center mb-8 lg:hidden">
                        <Link href="/" className="flex items-center gap-2">
                            <div className="bg-green-700 rounded-xl p-2.5">
                                <Tractor className="h-6 w-6 text-white" />
                            </div>
                            <span className="text-2xl font-black text-green-700">FarmRent</span>
                        </Link>
                    </div>

                    {/* Language selector */}
                    <div className="flex justify-end mb-4">
                        <Link href={`/select-language?next=/login`}
                            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-700 transition-colors font-medium bg-gray-50 hover:bg-green-50 rounded-lg px-3 py-1.5 border border-gray-200 hover:border-green-300">
                            <Globe className="h-3.5 w-3.5" />
                            <span>{currentLanguage.name}</span>
                        </Link>
                    </div>

                    <div className="mb-8">
                        <h1 className="text-3xl font-black text-gray-900">{t('auth.welcomeBack')}</h1>
                        <p className="text-gray-500 mt-1">{t('auth.signInSubtitle')}</p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                        <div>
                            <Label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-gray-700">
                                {t('auth.email')}
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="you@example.com"
                                {...register('email')}
                                className={`h-11 rounded-xl ${errors.email ? 'border-red-400 focus-visible:ring-red-400' : 'border-gray-200'}`}
                            />
                            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <Label htmlFor="password" className="text-sm font-semibold text-gray-700">{t('auth.password')}</Label>
                                <Link href="/forgot-password" className="text-xs text-green-700 hover:underline font-medium">
                                    {t('auth.forgotPassword')}
                                </Link>
                            </div>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPass ? 'text' : 'password'}
                                    placeholder="Your password"
                                    {...register('password')}
                                    className={`h-11 rounded-xl pr-11 ${errors.password ? 'border-red-400 focus-visible:ring-red-400' : 'border-gray-200'}`}
                                />
                                <button
                                    type="button"
                                    aria-label={showPass ? 'Hide password' : 'Show password'}
                                    onClick={() => setShowPass(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-11 bg-green-700 hover:bg-green-800 rounded-xl font-bold text-base mt-1"
                            disabled={isSubmitting}
                        >
                            {isSubmitting
                                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('auth.signingIn')}</>
                                : t('auth.signIn')}
                        </Button>
                    </form>

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-gray-100" />
                        </div>
                        <div className="relative flex justify-center">
                            <span className="bg-white px-3 text-xs text-gray-400 font-medium">{t('auth.noAccount')}</span>
                        </div>
                    </div>

                    {/* Register links */}
                    <div className="grid grid-cols-2 gap-3">
                        <Link href="/register?role=farmer">
                            <button type="button" suppressHydrationWarning className="w-full border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 rounded-xl px-3 py-3 text-center transition-all group">
                                <div className="text-xl mb-1">👨‍🌾</div>
                                <p className="text-xs font-bold text-gray-700 group-hover:text-green-700">{t('auth.rentEquipment')}</p>
                                <p className="text-[10px] text-gray-400">{t('auth.registerFarmer')}</p>
                            </button>
                        </Link>
                        <Link href="/register?role=owner">
                            <button type="button" suppressHydrationWarning className="w-full border-2 border-gray-100 hover:border-green-300 hover:bg-green-50 rounded-xl px-3 py-3 text-center transition-all group">
                                <div className="text-xl mb-1">🚜</div>
                                <p className="text-xs font-bold text-gray-700 group-hover:text-green-700">{t('auth.listEquipment')}</p>
                                <p className="text-[10px] text-gray-400">{t('auth.registerOwner')}</p>
                            </button>
                        </Link>
                    </div>
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

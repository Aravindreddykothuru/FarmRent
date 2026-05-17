'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useRef, Suspense } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Tractor, Loader2, Eye, EyeOff, CheckCircle2, IndianRupee, MailCheck, Globe, Mail,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { nodeApi } from '@/lib/api';
import PincodeField, { PincodeResult } from '@/components/PincodeField';

type EmailStep = 'idle' | 'sending' | 'awaiting_otp' | 'verifying' | 'verified';

/* ── Password strength ─────────────────────────────────────────────────────── */
type Strength = 0 | 1 | 2 | 3 | 4;

function measureStrength(pw: string): Strength {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)           score++;
    if (/[A-Z]/.test(pw))         score++;
    if (/[0-9]/.test(pw))         score++;
    if (/[^A-Za-z0-9]/.test(pw))  score++;
    return score as Strength;
}

const STRENGTH_COLORS: Record<Strength, string> = {
    0: 'bg-gray-200', 1: 'bg-red-400', 2: 'bg-amber-400', 3: 'bg-blue-500', 4: 'bg-green-600',
};
const STRENGTH_TEXT: Record<Strength, string> = {
    0: 'text-gray-400', 1: 'text-red-500', 2: 'text-amber-600', 3: 'text-blue-600', 4: 'text-green-700',
};

function PasswordStrengthBar({ password }: { password: string }) {
    const { t } = useLanguage();
    const strength = measureStrength(password);
    const STRENGTH_LABELS: Record<Strength, string> = {
        0: '', 1: t('register.strengthWeak'), 2: t('register.strengthFair'),
        3: t('register.strengthStrong'), 4: t('register.strengthVeryStrong'),
    };
    if (!password) return null;
    return (
        <div className="mt-1.5">
            <div className="flex gap-1 mb-1">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
                        i <= strength ? STRENGTH_COLORS[strength] : 'bg-gray-200'
                    }`} />
                ))}
            </div>
            {STRENGTH_LABELS[strength] && (
                <p className={`text-xs font-semibold ${STRENGTH_TEXT[strength]}`}>
                    {STRENGTH_LABELS[strength]}
                    {strength < 4 && (
                        <span className="text-gray-400 font-normal ml-1">
                            — {strength < 2 ? t('register.addUppercaseNumberSymbol') : strength === 2 ? t('register.addNumberSymbol') : t('register.addSpecialChar')}
                        </span>
                    )}
                </p>
            )}
        </div>
    );
}

/* ── Schema ─────────────────────────────────────────────────────────────────── */
const passwordSchema = z.string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'One uppercase letter required')
    .regex(/[0-9]/, 'One number required')
    .regex(/[^A-Za-z0-9]/, 'One special character required');

const registerSchema = z.object({
    name:            z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
    email:           z.string().email('Enter a valid email address'),
    phone:           z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    pincode:         z.string().length(6).regex(/^\d+$/).optional().or(z.literal('')),
    village:         z.string().max(100).trim().optional(),
    district:        z.string().max(100).trim().optional(),
    state:           z.string().max(100).trim().optional(),
    role:            z.enum(['farmer', 'owner']),
    password:        passwordSchema,
    confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

type RegisterForm = z.infer<typeof registerSchema>;

function RegisterInner() {
    const router        = useRouter();
    const searchParams  = useSearchParams();
    const { register: authRegister } = useAuth();
    const { currentLanguage, t } = useLanguage();

    const OWNER_PERKS  = [t('register.ownerPerk1'), t('register.ownerPerk2'), t('register.ownerPerk3'), t('register.ownerPerk4')];
    const FARMER_PERKS = [t('register.farmerPerk1'), t('register.farmerPerk2'), t('register.farmerPerk3'), t('register.farmerPerk4')];

    const [showPass,        setShowPass]       = useState(false);
    const [showConf,        setShowConf]       = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
    const [passwordValue,   setPasswordValue]  = useState('');

    /* Email OTP state */
    const [emailStep,     setEmailStep]    = useState<EmailStep>('idle');
    const [emailOtpValue, setEmailOtpValue] = useState('');
    const [emailOtpError, setEmailOtpError] = useState('');

    /* Duplicate availability check */
    const [emailTaken, setEmailTaken] = useState(false);
    const [phoneTaken, setPhoneTaken] = useState(false);
    const emailDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const checkEmailAvailability = async (email: string) => {
        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return;
        try {
            const res = await nodeApi.get<{ emailTaken: boolean }>(`/auth/check-availability?email=${encodeURIComponent(email)}`);
            setEmailTaken(!!res?.emailTaken);
        } catch { /* fail open */ }
    };

    const checkPhoneAvailability = async (phone: string) => {
        if (!phone || phone.length !== 10) return;
        try {
            const res = await nodeApi.get<{ phoneTaken: boolean }>(`/auth/check-availability?phone=${encodeURIComponent(phone)}`);
            setPhoneTaken(!!res?.phoneTaken);
        } catch { /* fail open */ }
    };

    const defaultRole = (searchParams?.get('role') === 'owner' ? 'owner' : 'farmer') as 'farmer' | 'owner';

    const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting } } = useForm<RegisterForm>({
        resolver: zodResolver(registerSchema),
        defaultValues: { role: defaultRole },
    });

    const role      = watch('role');
    const emailVal  = watch('email');
    const perks     = role === 'owner' ? OWNER_PERKS : FARMER_PERKS;

    /* ── Email OTP handlers ── */
    const handleSendEmailOTP = async () => {
        if (!emailVal) { setEmailOtpError('Enter your email address first'); return; }
        setEmailStep('sending');
        setEmailOtpError('');
        setEmailOtpValue('');
        try {
            const res = await nodeApi.post<{ success: boolean; message?: string; devOtp?: string }>(
                '/auth/reg-email-send-otp', { email: emailVal }
            );
            setEmailStep('awaiting_otp');
            if (res?.devOtp) {
                setEmailOtpValue(res.devOtp);
                toast.info(`Dev OTP: ${res.devOtp}`);
            } else {
                toast.success(res?.message ?? `OTP sent to ${emailVal}`);
            }
        } catch (err: unknown) {
            setEmailStep('idle');
            setEmailOtpError(err instanceof Error ? err.message : 'Failed to send OTP');
        }
    };

    const handleVerifyEmailOTP = async () => {
        if (emailOtpValue.length !== 6) return;
        setEmailStep('verifying');
        setEmailOtpError('');
        try {
            await nodeApi.post('/auth/reg-email-verify-otp', { email: emailVal, otp: emailOtpValue });
            setEmailStep('verified');
            toast.success('Email verified!');
        } catch (err: unknown) {
            setEmailStep('awaiting_otp');
            setEmailOtpError(err instanceof Error ? err.message : 'Invalid OTP');
        }
    };

    /* ── Pincode auto-fill ── */
    const handlePincodeResolved = (result: PincodeResult) => {
        const opts = { shouldDirty: true, shouldTouch: true } as const;
        setValue('pincode',  result.pincode, opts);
        setValue('village',  result.village ? `${result.village}, ${result.town}` : result.town, opts);
        setValue('district', result.town,    opts);
        setValue('state',    result.state,   opts);
    };

    /* ── Form submit ── */
    const onSubmit = async (data: RegisterForm) => {
        if (emailStep !== 'verified') {
            toast.error('Please verify your email first');
            return;
        }
        try {
            const { confirmPassword: _, ...payload } = data;
            await authRegister({
                ...payload,
                pincode:  payload.pincode  || undefined,
                village:  payload.village  || undefined,
                district: payload.district || undefined,
                state:    payload.state    || undefined,
            });
            setRegisteredEmail(data.email);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('register.registrationFailed'));
        }
    };

    const fieldCls = (name: keyof RegisterForm) =>
        `h-10 rounded-xl text-sm ${errors[name] ? 'border-red-400 focus-visible:ring-red-400' : 'border-gray-200'}`;

    /* ── Success screen ── */
    if (registeredEmail) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] px-4">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8 max-w-md w-full text-center">
                    <MailCheck className="w-14 h-14 text-green-500 mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-gray-900 mb-2">{t('auth.accountCreated')}</h1>
                    <p className="text-gray-500 text-sm mb-6">
                        {t('auth.registerSuccess')}{' '}
                        <strong className="text-gray-700">{registeredEmail}</strong>.
                        {' '}{t('auth.verifyPhoneFirst')}.
                    </p>
                    <p className="text-xs text-gray-400 mb-6">
                        {t('register.didntReceive')}{' '}
                        <Link href="/verify-email" className="text-green-700 hover:underline font-semibold">
                            {t('register.requestNewLink')}
                        </Link>.
                    </p>
                    <Button
                        className="w-full bg-green-700 hover:bg-green-800 font-bold rounded-xl"
                        onClick={() => router.push('/login')}
                    >
                        {t('auth.goToLogin')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex">

            {/* ── Left panel ──────────────────────────────────────────── */}
            <div className="hidden lg:flex lg:w-[42%] bg-gradient-to-br from-green-950 via-green-900 to-green-800 flex-col justify-between p-12 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-80 bg-yellow-400/10 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-green-400/10 rounded-full blur-2xl pointer-events-none" />

                <Link href="/" className="flex items-center gap-2.5 relative z-10">
                    <div className="bg-white/10 backdrop-blur rounded-xl p-2.5">
                        <Tractor className="h-6 w-6 text-white" />
                    </div>
                    <span className="text-2xl font-black text-white">FarmRent</span>
                </Link>

                <div className="relative z-10">
                    {role === 'owner' ? (
                        <>
                            <div className="w-16 h-16 rounded-2xl bg-yellow-400/20 flex items-center justify-center mb-5">
                                <IndianRupee className="h-8 w-8 text-yellow-300" />
                            </div>
                            <h2 className="text-4xl font-black text-white leading-tight mb-3">
                                {t('register.ownerHeading')}
                            </h2>
                            <p className="text-green-200 text-sm leading-relaxed mb-7">
                                {t('register.ownerDesc')}
                            </p>
                        </>
                    ) : (
                        <>
                            <div className="w-16 h-16 rounded-2xl bg-green-400/20 flex items-center justify-center mb-5">
                                <span className="text-3xl">👨‍🌾</span>
                            </div>
                            <h2 className="text-4xl font-black text-white leading-tight mb-3">
                                {t('register.farmerHeading')}
                            </h2>
                            <p className="text-green-200 text-sm leading-relaxed mb-7">
                                {t('register.farmerDesc')}
                            </p>
                        </>
                    )}
                    <ul className="space-y-3">
                        {perks.map(p => (
                            <li key={p} className="flex items-center gap-3">
                                <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                                <span className="text-green-100 text-sm">{p}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <p className="text-green-400 text-xs relative z-10">
                    {t('register.alreadyHaveAccount')}{' '}
                    <Link href="/login" className="text-white font-bold hover:underline">{t('auth.signIn')} →</Link>
                </p>
            </div>

            {/* ── Right panel (form) ─────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto bg-white">
                <div className="min-h-full flex items-start justify-center px-5 py-10">
                    <div className="w-full max-w-lg">

                        {/* Mobile logo */}
                        <div className="flex justify-center mb-7 lg:hidden">
                            <Link href="/" className="flex items-center gap-2">
                                <div className="bg-green-700 rounded-xl p-2.5">
                                    <Tractor className="h-6 w-6 text-white" />
                                </div>
                                <span className="text-2xl font-black text-green-700">FarmRent</span>
                            </Link>
                        </div>

                        {/* Language selector */}
                        <div className="flex justify-end mb-4">
                            <Link href={`/select-language?next=/register`}
                                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-green-700 transition-colors font-medium bg-gray-50 hover:bg-green-50 rounded-lg px-3 py-1.5 border border-gray-200 hover:border-green-300">
                                <Globe className="h-3.5 w-3.5" />
                                <span>{currentLanguage.name}</span>
                            </Link>
                        </div>

                        <div className="mb-7">
                            <h1 className="text-3xl font-black text-gray-900">{t('auth.createAccount')}</h1>
                            <p className="text-gray-500 text-sm mt-1">{t('auth.createAccountSubtitle')}</p>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

                            {/* Role selector */}
                            <div>
                                <Label className="mb-2 block text-sm font-semibold text-gray-700">{t('auth.iWantTo')}</Label>
                                <Controller
                                    name="role"
                                    control={control}
                                    render={({ field }) => (
                                        <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-2 gap-3">
                                            {(['farmer', 'owner'] as const).map(r => (
                                                <label
                                                    key={r}
                                                    htmlFor={`role-${r}`}
                                                    className={`flex items-center gap-3 border-2 rounded-xl p-3.5 cursor-pointer transition-all ${
                                                        field.value === r
                                                            ? 'border-green-600 bg-green-50 shadow-sm'
                                                            : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <RadioGroupItem value={r} id={`role-${r}`} className="sr-only" />
                                                    <span className="text-xl">{r === 'farmer' ? '👨‍🌾' : '🚜'}</span>
                                                    <div>
                                                        <p className="font-bold text-gray-800 text-sm">
                                                            {r === 'farmer' ? t('auth.rentEquipment') : t('auth.listEquipment')}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400">
                                                            {r === 'farmer' ? t('auth.rentMachinesDesc') : t('auth.ownMachinesDesc')}
                                                        </p>
                                                    </div>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    )}
                                />
                            </div>

                            {/* ── Email OTP verification ── */}
                            <div className="border-2 border-dashed border-gray-200 rounded-2xl p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Mail className="h-4 w-4 text-green-700" />
                                    <span className="text-sm font-bold text-gray-700">Verify your email</span>
                                    {emailStep === 'verified' && (
                                        <span className="ml-auto flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                                            <CheckCircle2 className="h-3 w-3" /> Verified
                                        </span>
                                    )}
                                </div>

                                {emailStep === 'verified' ? (
                                    <div className="flex items-center gap-2 h-10 px-3 rounded-xl border-2 border-green-400 bg-green-50">
                                        <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                                        <span className="text-sm font-semibold text-green-700">{emailVal}</span>
                                        <button
                                            type="button"
                                            onClick={() => { setEmailStep('idle'); setEmailOtpValue(''); setValue('email', '', { shouldDirty: true }); }}
                                            className="ml-auto text-xs text-gray-400 hover:text-gray-600 underline"
                                        >
                                            Change
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex gap-2">
                                            <Input
                                                id="email"
                                                type="email"
                                                placeholder="raju@example.com"
                                                {...register('email')}
                                                onChange={e => { register('email').onChange(e); if (emailStep !== 'idle') { setEmailStep('idle'); setEmailOtpValue(''); } setEmailOtpError(''); setEmailTaken(false); }}
                                                onBlur={e => { register('email').onBlur(e); const v = e.target.value; if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current); emailDebounceRef.current = setTimeout(() => checkEmailAvailability(v), 300); }}
                                                disabled={emailStep === 'sending' || emailStep === 'verifying'}
                                                className={`flex-1 h-10 rounded-xl text-sm ${errors.email ? 'border-red-400' : 'border-gray-200'}`}
                                            />
                                            <Button
                                                type="button"
                                                onClick={handleSendEmailOTP}
                                                disabled={emailStep === 'sending' || emailStep === 'verifying' || emailTaken}
                                                className="h-10 px-4 bg-green-700 hover:bg-green-800 rounded-xl font-semibold text-sm whitespace-nowrap disabled:opacity-60"
                                            >
                                                {emailStep === 'sending'
                                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                                    : emailStep === 'awaiting_otp' ? 'Resend OTP' : 'Send OTP'}
                                            </Button>
                                        </div>
                                        {errors.email && <p className="text-red-500 text-xs -mt-1">{errors.email.message}</p>}
                                        {emailTaken && !errors.email && (
                                            <p className="text-amber-600 text-xs -mt-1">
                                                This email is already registered.{' '}
                                                <Link href="/login" className="underline font-semibold">Sign in instead</Link>
                                            </p>
                                        )}

                                        {(emailStep === 'awaiting_otp' || emailStep === 'verifying') && (
                                            <div className="space-y-1.5 pt-1">
                                                <p className="text-xs text-gray-500">OTP sent to <strong>{emailVal}</strong> — check your inbox</p>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        placeholder="Enter 6-digit OTP"
                                                        value={emailOtpValue}
                                                        onChange={e => { setEmailOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setEmailOtpError(''); }}
                                                        maxLength={6}
                                                        className="flex-1 border border-gray-200 rounded-xl px-3 h-10 text-sm tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-green-500"
                                                        autoFocus
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={handleVerifyEmailOTP}
                                                        disabled={emailOtpValue.length !== 6 || emailStep === 'verifying'}
                                                        className="h-10 px-4 bg-green-700 hover:bg-green-800 rounded-xl font-semibold text-sm disabled:opacity-60"
                                                    >
                                                        {emailStep === 'verifying' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                        {emailOtpError && <p className="text-red-500 text-xs">{emailOtpError}</p>}
                                    </>
                                )}
                            </div>

                            {/* ── Rest of form (locked until email verified) ── */}
                            <div className={`space-y-3 transition-opacity duration-300 ${emailStep !== 'verified' ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="sm:col-span-2">
                                        <Label htmlFor="name" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.name')} *</Label>
                                        <Input id="name" placeholder="Raju Reddy" {...register('name')} className={fieldCls('name')} />
                                        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                                    </div>

                                    <div className="sm:col-span-2">
                                        <Label htmlFor="phone" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.phone')} *</Label>
                                        <div className={`flex items-center rounded-xl overflow-hidden border ${errors.phone ? 'border-red-400' : 'border-gray-200'} focus-within:ring-2 focus-within:ring-green-500`}>
                                            <span className="px-3 text-sm text-gray-500 border-r border-gray-200 bg-gray-50 h-10 flex items-center select-none">+91</span>
                                            <input
                                                type="tel"
                                                inputMode="numeric"
                                                placeholder="9876543210"
                                                maxLength={10}
                                                {...register('phone')}
                                                onChange={e => { setValue('phone', e.target.value.replace(/\D/g, '').slice(0, 10), { shouldDirty: true }); setPhoneTaken(false); }}
                                                onBlur={e => { const v = e.target.value.replace(/\D/g, ''); if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current); phoneDebounceRef.current = setTimeout(() => checkPhoneAvailability(v), 300); }}
                                                className="flex-1 px-3 text-sm h-10 outline-none bg-transparent"
                                            />
                                        </div>
                                        {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone.message}</p>}
                                        {phoneTaken && !errors.phone && (
                                            <p className="text-amber-600 text-xs mt-1">
                                                This phone number is already linked to an account.{' '}
                                                <Link href="/login" className="underline font-semibold">Sign in</Link>
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <PincodeField onResolved={handlePincodeResolved} className="h-10 rounded-xl text-sm border-gray-200" />
                                    </div>
                                    <div>
                                        <Label htmlFor="village" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.village')}</Label>
                                        <Input id="village" placeholder={t('register.autoFilled')} {...register('village')} className={fieldCls('village')} />
                                    </div>
                                    <div>
                                        <Label htmlFor="district" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.district')}</Label>
                                        <Input id="district" placeholder={t('register.autoFilled')} {...register('district')} className={fieldCls('district')} />
                                    </div>
                                    <div>
                                        <Label htmlFor="state" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.state')}</Label>
                                        <Input id="state" placeholder={t('register.autoFilled')} {...register('state')} className={fieldCls('state')} />
                                    </div>

                                    <div>
                                        <Label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.passwordLabel')} *</Label>
                                        <div className="relative">
                                            <Input id="password" type={showPass ? 'text' : 'password'} placeholder={t('register.passwordPlaceholder')}
                                                {...register('password', { onChange: e => setPasswordValue(e.target.value) })}
                                                className={`${fieldCls('password')} pr-10`} />
                                            <button type="button" suppressHydrationWarning onClick={() => setShowPass(v => !v)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                        <PasswordStrengthBar password={passwordValue} />
                                        {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
                                    </div>

                                    <div>
                                        <Label htmlFor="confirmPassword" className="mb-1.5 block text-xs font-semibold text-gray-600">{t('auth.confirmPassword')} *</Label>
                                        <div className="relative">
                                            <Input id="confirmPassword" type={showConf ? 'text' : 'password'} placeholder="Re-enter password"
                                                {...register('confirmPassword')} className={`${fieldCls('confirmPassword')} pr-10`} />
                                            <button type="button" suppressHydrationWarning onClick={() => setShowConf(v => !v)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                                {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                        {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword.message}</p>}
                                    </div>
                                </div>
                            </div>

                            <Button
                                type="submit"
                                size="lg"
                                className="w-full h-11 bg-green-700 hover:bg-green-800 rounded-xl font-bold text-base disabled:opacity-60"
                                disabled={isSubmitting || emailStep !== 'verified'}
                            >
                                {isSubmitting
                                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('auth.creatingAccount')}</>
                                    : emailStep !== 'verified'
                                    ? 'Verify email to continue'
                                    : t(role === 'owner' ? 'auth.createOwnerAccount' : 'auth.createFarmerAccount')}
                            </Button>
                        </form>

                        <p className="text-center text-sm text-gray-500 mt-5">
                            {t('auth.alreadyHaveAccount')}{' '}
                            <Link href="/login" className="text-green-700 font-bold hover:underline">{t('auth.signIn')}</Link>
                        </p>

                        <p className="text-center text-xs text-gray-400 mt-3 leading-relaxed">
                            {t('register.termsAgreement')}{' '}
                            <Link href="/" className="underline hover:text-gray-600">{t('register.termsOfService')}</Link>
                            {' '}{t('register.and')}{' '}
                            <Link href="/" className="underline hover:text-gray-600">{t('register.privacyPolicy')}</Link>.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function RegisterPage() {
    return (
        <Suspense>
            <RegisterInner />
        </Suspense>
    );
}

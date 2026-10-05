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
    Tractor, Loader2, Eye, EyeOff, CheckCircle2, IndianRupee, MailCheck, Mail, AlertCircle, Smartphone,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { nodeApi } from '@/lib/api';
import PincodeField, { PincodeResult } from '@/components/PincodeField';
import { LanguageQuickBar, NeedHelpButton } from '@/components/AuthAssist';
import { OtpInput, PhoneField, usePhoneOtp, isIndianMobile, OTP_LENGTH } from '@/components/PhoneOtp';

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
                        i <= strength ? STRENGTH_COLORS[strength] : 'bg-white/20'
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

/* ── Step progress ──────────────────────────────────────────────────────────── */
/**
 * This form is a single page, not a wizard, but it does move through three real
 * phases: prove the email, fill in the details, done. Naming them tells a first-time
 * user how much is left without restructuring a flow that already works.
 */
function StepProgress({ current }: { current: 1 | 2 | 3 }) {
    const { t } = useLanguage();
    const labels = [t('register.stepVerify'), t('register.stepDetails'), t('register.stepDone')];

    return (
        <div className="mb-6">
            <p className="mb-2 text-base font-bold text-green-50">
                {t('register.stepOf', { current, total: 3 })} — {labels[current - 1]}
            </p>
            <div className="flex gap-2" aria-hidden="true">
                {[1, 2, 3].map(i => (
                    <div
                        key={i}
                        className={`h-2.5 flex-1 rounded-full transition-colors duration-300 ${
                            i <= current ? 'bg-green-400' : 'bg-white/20'
                        }`}
                    />
                ))}
            </div>
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
    const { register: authRegister, loginWithToken } = useAuth();
    const { t } = useLanguage();

    const OWNER_PERKS  = [t('register.ownerPerk1'), t('register.ownerPerk2'), t('register.ownerPerk3'), t('register.ownerPerk4')];
    const FARMER_PERKS = [t('register.farmerPerk1'), t('register.farmerPerk2'), t('register.farmerPerk3'), t('register.farmerPerk4')];

    const [showPass,        setShowPass]       = useState(false);
    const [showConf,        setShowConf]       = useState(false);
    const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
    const [passwordValue,   setPasswordValue]  = useState('');

    /* Which channel proves this person before the form unlocks. Either works; both reach the same account. */
    const [verifyBy, setVerifyBy] = useState<'email' | 'phone'>('email');
    const [signupToken, setSignupToken] = useState<string | null>(null);
    const [otpValue, setOtpValue] = useState('');
    const phoneOtp = usePhoneOtp('signup');

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
            const res = await nodeApi.post<{ success: boolean; message?: string; devOtp?: string; devNote?: string }>(
                '/auth/reg-email-send-otp', { email: emailVal }
            );
            setEmailStep('awaiting_otp');
            if (res?.devOtp) {
                setEmailOtpValue(res.devOtp);
                toast.info(`Dev OTP: ${res.devOtp}`, { duration: 15000 });
                if (res.devNote) toast.info(res.devNote, { duration: 10000 });
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

    /* Either channel unlocks the rest of the form. */
    const verified = verifyBy === 'email' ? emailStep === 'verified' : !!signupToken;

    /** Proves the number, then keeps the signup token that step 3 needs. */
    const verifyPhone = async (code: string) => {
        const phone = watch('phone');
        const res = await phoneOtp.verify<{ signupToken: string }>(phone, code);
        if (!res) { setOtpValue(''); return; }
        setSignupToken(res.signupToken);
    };

    /* ── Form submit ── */
    const onSubmit = async (data: RegisterForm) => {
        if (!verified) {
            toast.error(verifyBy === 'email' ? 'Please verify your email first' : 'Please verify your mobile number first');
            return;
        }
        try {
            const { confirmPassword: _, ...payload } = data;

            if (verifyBy === 'phone' && signupToken) {
                // The number is already proved, so it travels in the token rather than the body.
                const res = await nodeApi.post<{ token: string; user: { role: string } }>('/auth/phone/register', {
                    signupToken,
                    name: payload.name,
                    email: payload.email,
                    password: payload.password,
                    role: payload.role,
                    village: payload.village || undefined,
                    district: payload.district || undefined,
                    state: payload.state || undefined,
                });
                loginWithToken(res.token, res.user as never);
                toast.success(t('auth.accountCreated'));
                router.push(payload.role === 'owner' ? '/dashboard/owner' : '/dashboard/farmer');
                return;
            }

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
        `h-12 rounded-xl border-white/20 bg-white/10 text-base text-white placeholder:text-green-100/50 focus-visible:ring-green-300 ${errors[name] ? 'border-red-400' : ''}`;

    /** Small helper so every field reports its error the same way: icon + plain words. */
    const FieldError = ({ name }: { name: keyof RegisterForm }) =>
        errors[name] ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {errors[name]?.message as string}
            </p>
        ) : null;

    /* ── Success screen ── */
    if (registeredEmail) {
        return (
            <div className="flex min-h-screen items-center justify-center overflow-x-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-900 px-4">
                <div className="w-full max-w-md rounded-3xl border border-white/15 bg-green-950/40 p-6 text-center backdrop-blur-2xl backdrop-saturate-150 sm:p-8" style={{ boxShadow: '0 35px 70px rgba(0,0,0,0.45), inset 0 1.5px 2px rgba(255,255,255,0.22)' }}>
                    <StepProgress current={3} />
                    <MailCheck className="mx-auto mb-4 h-16 w-16 text-green-300" />
                    <h1 className="mb-2 text-2xl font-bold text-white">✅ {t('auth.accountCreated')}</h1>
                    <p className="mb-6 text-base text-green-100/90">
                        {t('auth.registerSuccess')}{' '}
                        <strong className="break-words text-white">{registeredEmail}</strong>.
                        {' '}{t('auth.verifyPhoneFirst')}.
                    </p>
                    <p className="mb-6 text-sm text-green-100/80">
                        {t('register.didntReceive')}{' '}
                        <Link href="/verify-email" className="font-semibold text-green-200 hover:text-white hover:underline">
                            {t('register.requestNewLink')}
                        </Link>.
                    </p>
                    <Button
                        className="h-14 w-full rounded-xl bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 text-lg font-bold text-white shadow-lg shadow-green-900/50 hover:brightness-110"
                        onClick={() => router.push('/login')}
                    >
                        {t('auth.goToLogin')}
                    </Button>
                    <NeedHelpButton tone="dark" />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex overflow-x-hidden">

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
            {/*
             * The "login page v2" mock's signature is a gradient panel sweeping diagonally behind a dark
             * card with a glowing edge. That is reproduced here in FarmRent green with a CSS transform
             * rather than framer-motion: the sweep is decorative, and a new animation dependency is not
             * worth the bytes on the phones this screen is opened on. It slides when the verification
             * channel changes, so the motion tracks a real state change instead of running for show.
             */}
            <div className="relative flex-1 overflow-y-auto bg-gradient-to-br from-green-950 via-green-900 to-emerald-900">
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-[10%] h-[120%] w-[250%] bg-gradient-to-br from-green-700/40 to-emerald-500/20 transition-transform duration-700 ease-in-out motion-reduce:transition-none"
                    style={{ transform: `skewX(20deg) translateX(${verifyBy === 'email' ? '10%' : '-70%'})` }}
                />
                <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                    <div className="absolute -top-24 right-0 h-96 w-96 rounded-full bg-yellow-400/10 blur-3xl" />
                    <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
                </div>

                <div className="relative z-10 min-h-full flex items-start justify-center px-4 py-8 sm:px-5 sm:py-10">
                    <div
                        className="w-full max-w-lg rounded-3xl border border-white/15 bg-green-950/40 p-5 backdrop-blur-2xl backdrop-saturate-150 sm:p-7"
                        style={{
                            boxShadow:
                                '0 35px 70px rgba(0,0,0,0.45), inset 0 1.5px 2px rgba(255,255,255,0.22), inset 0 -1px 2px rgba(0,0,0,0.3)',
                        }}
                    >

                        {/* Mobile logo + tagline */}
                        <div className="mb-6 lg:hidden">
                            <Link href="/" className="flex items-center justify-center gap-2">
                                <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur">
                                    <Tractor className="h-7 w-7 text-white" />
                                </div>
                                <span className="text-3xl font-black text-white">FarmRent</span>
                            </Link>
                        </div>

                        <LanguageQuickBar next="/register" tone="dark" />

                        <div className="mb-6">
                            <h1 className="text-3xl font-black text-white">{t('auth.createAccount')}</h1>
                            <p className="mt-1 text-base text-green-100/90">{t('auth.createAccountSubtitle')}</p>
                        </div>

                        <StepProgress current={verified ? 2 : 1} />

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">

                            {/* Role selector */}
                            <div>
                                <Label className="mb-2 block text-base font-semibold text-green-50">{t('auth.iWantTo')}</Label>
                                <Controller
                                    name="role"
                                    control={control}
                                    render={({ field }) => (
                                        <RadioGroup value={field.value} onValueChange={field.onChange} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {(['farmer', 'owner'] as const).map(r => (
                                                <label
                                                    key={r}
                                                    htmlFor={`role-${r}`}
                                                    className={`flex min-h-[72px] items-center gap-3 border-2 rounded-xl p-4 cursor-pointer transition-all ${
                                                        field.value === r
                                                            ? 'border-green-400 bg-green-600/20 shadow-sm'
                                                            : 'border-white/20 bg-white/5 hover:border-green-300 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <RadioGroupItem value={r} id={`role-${r}`} className="sr-only" />
                                                    <span className="text-3xl" aria-hidden="true">{r === 'farmer' ? '👨‍🌾' : '🚜'}</span>
                                                    <div>
                                                        <p className="text-base font-bold text-white">
                                                            {r === 'farmer' ? t('auth.rentEquipment') : t('auth.listEquipment')}
                                                        </p>
                                                        <p className="text-base text-green-100/80">
                                                            {r === 'farmer' ? t('auth.rentMachinesDesc') : t('auth.ownMachinesDesc')}
                                                        </p>
                                                    </div>
                                                </label>
                                            ))}
                                        </RadioGroup>
                                    )}
                                />
                            </div>

                            {/* ── Prove who you are: email or mobile, whichever the person can use ── */}
                            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={t('auth.iWantTo')}>
                                <button
                                    type="button" role="tab" suppressHydrationWarning
                                    aria-selected={verifyBy === 'email'}
                                    onClick={() => setVerifyBy('email')}
                                    className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition-colors ${
                                        verifyBy === 'email'
                                            ? 'border-green-400 bg-green-600 text-white shadow-lg shadow-green-900/50'
                                            : 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
                                    }`}
                                >
                                    <Mail className="h-5 w-5" aria-hidden="true" />
                                    {t('auth.verifyByEmail')}
                                </button>
                                <button
                                    type="button" role="tab" suppressHydrationWarning
                                    aria-selected={verifyBy === 'phone'}
                                    onClick={() => setVerifyBy('phone')}
                                    className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-bold transition-colors ${
                                        verifyBy === 'phone'
                                            ? 'border-green-400 bg-green-600 text-white shadow-lg shadow-green-900/50'
                                            : 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
                                    }`}
                                >
                                    <Smartphone className="h-5 w-5" aria-hidden="true" />
                                    {t('auth.verifyByPhone')}
                                </button>
                            </div>

                            {verifyBy === 'phone' && (
                                <div className="space-y-3 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-4">
                                    <div className="flex items-center gap-2">
                                        <Smartphone className="h-5 w-5 text-green-300" aria-hidden="true" />
                                        <span className="text-base font-bold text-white">{t('auth.verifyByPhone')}</span>
                                        {signupToken && (
                                            <span className="ml-auto flex items-center gap-1 text-sm font-bold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                                                <CheckCircle2 className="h-4 w-4" /> {t('auth.phoneVerifiedBadge')}
                                            </span>
                                        )}
                                    </div>

                                    <PhoneField
                                        id="signup-phone"
                                        value={watch('phone') ?? ''}
                                        onChange={v => {
                                            setValue('phone', v, { shouldDirty: true });
                                            setSignupToken(null);
                                            setOtpValue('');
                                            phoneOtp.reset();
                                        }}
                                        disabled={!!signupToken || phoneOtp.sent}
                                        invalid={!!watch('phone') && !isIndianMobile(watch('phone'))}
                                        tone="dark"
                                    />

                                    {!signupToken && phoneOtp.sent && (
                                        <div className="space-y-2">
                                            <OtpInput
                                                value={otpValue}
                                                onChange={setOtpValue}
                                                onComplete={verifyPhone}
                                                disabled={phoneOtp.verifying}
                                                invalid={!!phoneOtp.error}
                                                autoFocus
                                                tone="dark"
                                            />
                                            {phoneOtp.devOtp && (
                                                <p className="text-sm text-yellow-300">Dev code: <strong>{phoneOtp.devOtp}</strong></p>
                                            )}
                                        </div>
                                    )}

                                    {phoneOtp.error && (
                                        <p className="text-red-600 text-sm flex items-center gap-1.5" role="alert">
                                            <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                                            {phoneOtp.error}
                                        </p>
                                    )}

                                    {!signupToken && (
                                        <div className="flex flex-wrap gap-2">
                                            {!phoneOtp.sent ? (
                                                <Button
                                                    type="button"
                                                    onClick={() => phoneOtp.send(watch('phone'))}
                                                    disabled={!isIndianMobile(watch('phone') ?? '') || phoneOtp.sending}
                                                    className="h-12 rounded-xl bg-green-600 px-5 text-base font-semibold hover:bg-green-500 disabled:opacity-50"
                                                >
                                                    {phoneOtp.sending && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                                                    {t('auth.sendOtp')}
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button
                                                        type="button"
                                                        onClick={() => verifyPhone(otpValue)}
                                                        disabled={otpValue.length !== OTP_LENGTH || phoneOtp.verifying}
                                                        className="h-12 rounded-xl bg-green-600 px-5 text-base font-semibold hover:bg-green-500 disabled:opacity-50"
                                                    >
                                                        {phoneOtp.verifying && <Loader2 className="h-5 w-5 animate-spin mr-2" />}
                                                        {t('auth.verify')}
                                                    </Button>
                                                    <button
                                                        type="button"
                                                        suppressHydrationWarning
                                                        onClick={() => { setOtpValue(''); phoneOtp.send(watch('phone')); }}
                                                        disabled={phoneOtp.secondsLeft > 0 || phoneOtp.sending}
                                                        className="h-12 px-3 text-base font-semibold text-green-200 hover:text-white hover:underline disabled:text-green-100/40 disabled:no-underline"
                                                    >
                                                        {phoneOtp.secondsLeft > 0
                                                            ? t('auth.resendIn', { seconds: phoneOtp.secondsLeft })
                                                            : t('auth.resendOtp')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Email OTP verification ── */}
                            {verifyBy === 'email' && (
                            <div className="space-y-3 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 p-4">
                                <div className="flex items-center gap-2">
                                    <Mail className="h-5 w-5 text-green-300" />
                                    <span className="text-base font-bold text-white">Verify your email</span>
                                    {emailStep === 'verified' && (
                                        <span className="ml-auto flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                                            <CheckCircle2 className="h-3 w-3" /> Verified
                                        </span>
                                    )}
                                </div>

                                {emailStep === 'verified' ? (
                                    <div className="flex min-h-[48px] items-center gap-2 rounded-xl border-2 border-green-400 bg-green-600/20 px-3">
                                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                                        {/* min-w-0 + truncate, or a long address pushes "Change" off a 360px screen */}
                                        <span className="min-w-0 truncate text-base font-semibold text-green-100">{emailVal}</span>
                                        <button
                                            type="button"
                                            suppressHydrationWarning
                                            onClick={() => { setEmailStep('idle'); setEmailOtpValue(''); setValue('email', '', { shouldDirty: true }); }}
                                            className="ml-auto flex-shrink-0 text-base text-green-200 underline hover:text-white"
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
                                                inputMode="email"
                                                autoComplete="email"
                                                className={`h-12 min-w-0 flex-1 rounded-xl border-white/20 bg-white/10 text-base text-white placeholder:text-green-100/50 focus-visible:ring-green-300 ${errors.email ? 'border-red-400' : ''}`}
                                            />
                                            <Button
                                                type="button"
                                                onClick={handleSendEmailOTP}
                                                disabled={emailStep === 'sending' || emailStep === 'verifying' || emailTaken}
                                                className="h-12 whitespace-nowrap rounded-xl bg-green-600 px-4 text-base font-semibold hover:bg-green-500 disabled:opacity-50"
                                            >
                                                {emailStep === 'sending'
                                                    ? <Loader2 className="h-5 w-5 animate-spin" />
                                                    : emailStep === 'awaiting_otp' ? 'Resend OTP' : 'Send OTP'}
                                            </Button>
                                        </div>
                                        <FieldError name="email" />
                                        {emailTaken && !errors.email && (
                                            <p className="-mt-1 text-sm text-amber-300">
                                                This email is already registered.{' '}
                                                <Link href="/login" className="font-semibold text-white underline">Sign in instead</Link>
                                            </p>
                                        )}

                                        {(emailStep === 'awaiting_otp' || emailStep === 'verifying') && (
                                            <div className="space-y-1.5 pt-1">
                                                <p className="text-base text-green-100">OTP sent to <strong className="break-words">{emailVal}</strong> — check your inbox</p>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        autoComplete="one-time-code"
                                                        placeholder="Enter 6-digit OTP"
                                                        value={emailOtpValue}
                                                        onChange={e => { setEmailOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); setEmailOtpError(''); }}
                                                        maxLength={6}
                                                        className="h-12 min-w-0 flex-1 rounded-xl border-2 border-white/25 bg-white/10 px-3 font-mono text-base tracking-widest text-white focus:outline-none focus:ring-2 focus:ring-green-300"
                                                        autoFocus
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={handleVerifyEmailOTP}
                                                        disabled={emailOtpValue.length !== 6 || emailStep === 'verifying'}
                                                        className="h-12 rounded-xl bg-green-600 px-5 text-base font-semibold hover:bg-green-500 disabled:opacity-50"
                                                    >
                                                        {emailStep === 'verifying' ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify'}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                        {emailOtpError && <p className="text-sm text-red-300">{emailOtpError}</p>}
                                    </>
                                )}
                            </div>
                            )}

                            {/* ── Rest of form (locked until the person is proved, by either channel) ── */}
                            <div className={`space-y-3 transition-opacity duration-300 ${!verified ? 'opacity-40 pointer-events-none select-none' : ''}`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="sm:col-span-2">
                                        <Label htmlFor="name" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.name')} *</Label>
                                        <Input id="name" placeholder="Raju Reddy" {...register('name')} className={fieldCls('name')} />
                                        <FieldError name="name" />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <Label htmlFor="phone" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.phone')} *</Label>
                                        <div className={`flex items-center rounded-xl overflow-hidden border ${errors.phone ? 'border-red-400' : 'border-gray-200'} focus-within:ring-2 focus-within:ring-green-500`}>
                                            <span className="px-3 text-base font-semibold text-gray-700 border-r border-gray-300 bg-gray-100 h-12 flex items-center select-none">+91</span>
                                            <input
                                                type="tel"
                                                inputMode="numeric"
                                                placeholder="9876543210"
                                                maxLength={10}
                                                {...register('phone')}
                                                onChange={e => { setValue('phone', e.target.value.replace(/\D/g, '').slice(0, 10), { shouldDirty: true }); setPhoneTaken(false); }}
                                                onBlur={e => { const v = e.target.value.replace(/\D/g, ''); if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current); phoneDebounceRef.current = setTimeout(() => checkPhoneAvailability(v), 300); }}
                                                className="flex-1 min-w-0 px-3 text-base h-12 outline-none bg-transparent"
                                            />
                                        </div>
                                        <FieldError name="phone" />
                                        {phoneTaken && !errors.phone && (
                                            <p className="text-amber-600 text-xs mt-1">
                                                This phone number is already linked to an account.{' '}
                                                <Link href="/login" className="font-semibold text-white underline">Sign in</Link>
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <PincodeField onResolved={handlePincodeResolved} tone="dark" />
                                    </div>
                                    <div>
                                        <Label htmlFor="village" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.village')}</Label>
                                        <Input id="village" placeholder={t('register.autoFilled')} {...register('village')} className={fieldCls('village')} />
                                    </div>
                                    <div>
                                        <Label htmlFor="district" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.district')}</Label>
                                        <Input id="district" placeholder={t('register.autoFilled')} {...register('district')} className={fieldCls('district')} />
                                    </div>
                                    <div>
                                        <Label htmlFor="state" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.state')}</Label>
                                        <Input id="state" placeholder={t('register.autoFilled')} {...register('state')} className={fieldCls('state')} />
                                    </div>

                                    <div>
                                        <Label htmlFor="password" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.passwordLabel')} *</Label>
                                        <div className="relative">
                                            <Input id="password" type={showPass ? 'text' : 'password'} placeholder={t('register.passwordPlaceholder')}
                                                {...register('password', { onChange: e => setPasswordValue(e.target.value) })}
                                                className={`${fieldCls('password')} pr-14`} />
                                            <button type="button" suppressHydrationWarning aria-label={showPass ? 'Hide password' : 'Show password'} onClick={() => setShowPass(v => !v)}
                                                className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-green-100/70 hover:text-white">
                                                {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                            </button>
                                        </div>
                                        <PasswordStrengthBar password={passwordValue} />
                                        <FieldError name="password" />
                                    </div>

                                    <div>
                                        <Label htmlFor="confirmPassword" className="mb-1.5 block text-base font-semibold text-green-50">{t('auth.confirmPassword')} *</Label>
                                        <div className="relative">
                                            <Input id="confirmPassword" type={showConf ? 'text' : 'password'} placeholder="Re-enter password"
                                                {...register('confirmPassword')} className={`${fieldCls('confirmPassword')} pr-14`} />
                                            <button type="button" suppressHydrationWarning aria-label={showConf ? 'Hide password' : 'Show password'} onClick={() => setShowConf(v => !v)}
                                                className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-green-100/70 hover:text-white">
                                                {showConf ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                            </button>
                                        </div>
                                        <FieldError name="confirmPassword" />
                                    </div>
                                </div>
                            </div>

                            <Button
                                type="submit"
                                size="lg"
                                className="h-14 w-full rounded-xl bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 text-lg font-bold text-white shadow-lg shadow-green-900/50 transition-all hover:brightness-110 disabled:opacity-50"
                                disabled={isSubmitting || !verified}
                            >
                                {isSubmitting
                                    ? <><Loader2 className="h-5 w-5 animate-spin mr-2" />{t('auth.creatingAccount')}</>
                                    : !verified
                                    ? (verifyBy === 'email' ? 'Verify email to continue' : 'Verify your number to continue')
                                    : t(role === 'owner' ? 'auth.createOwnerAccount' : 'auth.createFarmerAccount')}
                            </Button>
                        </form>

                        <p className="mt-5 text-center text-base text-green-100/90">
                            {t('auth.alreadyHaveAccount')}{' '}
                            <Link href="/login" className="font-bold text-green-200 hover:text-white hover:underline">{t('auth.signIn')}</Link>
                        </p>

                        <NeedHelpButton tone="dark" />

                        <p className="mt-4 text-center text-sm leading-relaxed text-green-100/70">
                            {t('register.termsAgreement')}{' '}
                            <Link href="/" className="underline hover:text-white">{t('register.termsOfService')}</Link>
                            {' '}{t('register.and')}{' '}
                            <Link href="/" className="underline hover:text-white">{t('register.privacyPolicy')}</Link>.
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

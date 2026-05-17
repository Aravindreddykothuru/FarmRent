'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';

interface UserProfile {
    id: string;
    name: string;
    email: string;
    role: string;
    phone?: string;
    avatar_url?: string;
    kyc_status?: string;
    created_at?: string;
}

const KYC_COLORS: Record<string, string> = {
    unverified: 'bg-gray-100 text-gray-600',
    pending:    'bg-yellow-100 text-yellow-700',
    verified:   'bg-green-100 text-green-700',
    rejected:   'bg-red-100 text-red-600',
};


export default function ProfilePage() {
    const { isAuthenticated, isLoading } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();

    const [profile, setProfile]   = useState<UserProfile | null>(null);
    const [name, setName]         = useState('');
    const [phone, setPhone]       = useState('');
    const [saving, setSaving]     = useState(false);

    // Password change
    const [showPwd, setShowPwd]           = useState(false);
    const [currentPwd, setCurrentPwd]     = useState('');
    const [newPwd, setNewPwd]             = useState('');
    const [confirmPwd, setConfirmPwd]     = useState('');
    const [changingPwd, setChangingPwd]   = useState(false);

    // Avatar
    const avatarRef                           = useRef<HTMLInputElement>(null);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);

    useEffect(() => {
        if (!isLoading && !isAuthenticated) router.push('/login');
    }, [isLoading, isAuthenticated, router]);

    useEffect(() => {
        if (!isAuthenticated) return;
        nodeApi.get<{ success: boolean; user: UserProfile }>('/users/profile')
            .then(r => {
                setProfile(r.user);
                setName(r.user.name ?? '');
                setPhone(r.user.phone ?? '');
            })
            .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : 'Failed to load profile';
                toast.error(msg);
            });
    }, [isAuthenticated]);

    const handleSave = async () => {
        if (!name.trim()) { toast.error('Name is required'); return; }
        setSaving(true);
        try {
            const r = await nodeApi.patch<{ success: boolean; user: UserProfile }>(
                '/users/profile',
                { name: name.trim(), phone: phone.trim() || null },
            );
            setProfile(r.user);
            toast.success('Profile updated');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to update profile');
        } finally {
            setSaving(false);
        }
    };

    const validateNewPassword = (pwd: string): string | null => {
        if (pwd.length < 8)            return 'Password must be at least 8 characters';
        if (!/[A-Z]/.test(pwd))        return 'Must contain at least one uppercase letter';
        if (!/[0-9]/.test(pwd))        return 'Must contain at least one number';
        if (!/[^A-Za-z0-9]/.test(pwd)) return 'Must contain at least one special character';
        return null;
    };

    const handleChangePassword = async () => {
        if (!currentPwd || !newPwd) { toast.error('All fields are required'); return; }
        if (newPwd !== confirmPwd)  { toast.error('New passwords do not match'); return; }
        const pwdError = validateNewPassword(newPwd);
        if (pwdError) { toast.error(pwdError); return; }

        setChangingPwd(true);
        try {
            await nodeApi.post('/users/change-password', {
                currentPassword: currentPwd,
                newPassword: newPwd,
            });
            toast.success('Password changed successfully');
            setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
            setShowPwd(false);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to change password');
        } finally {
            setChangingPwd(false);
        }
    };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast.error('Only image files allowed'); return; }
        if (file.size > 3 * 1024 * 1024)    { toast.error('Image must be under 3 MB'); return; }

        setUploadingAvatar(true);
        try {
            const formData = new FormData();
            formData.append('avatar', file);
            const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
            const res = await fetch('/api/v1/users/avatar', {
                method:  'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body:    formData,
            });
            const data = await res.json() as { avatarUrl?: string; message?: string };
            if (!res.ok) throw new Error(data.message ?? 'Upload failed');
            setProfile(p => p ? { ...p, avatar_url: data.avatarUrl } : p);
            toast.success('Avatar updated');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Avatar upload failed');
        } finally {
            setUploadingAvatar(false);
            // reset so the same file can be re-selected
            e.target.value = '';
        }
    };

    if (isLoading || !profile) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-700" />
            </div>
        );
    }

    const kycStatus = profile.kyc_status ?? 'unverified';
    const kycColor = KYC_COLORS[kycStatus] ?? KYC_COLORS.unverified;
    const kycLabelKey = `profile.kyc${kycStatus.charAt(0).toUpperCase() + kycStatus.slice(1)}` as any;

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-4">
            <div className="max-w-2xl mx-auto space-y-6">
                <h1 className="text-2xl font-bold text-gray-900">{t('profile.title')}</h1>

                {/* Avatar + info card */}
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <div className="flex items-center gap-5 mb-6">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center overflow-hidden">
                                {profile.avatar_url
                                    ? <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                                    : <span className="text-3xl font-bold text-green-700">{profile.name?.[0]?.toUpperCase()}</span>
                                }
                            </div>
                            <button
                                type="button"
                                suppressHydrationWarning
                                onClick={() => avatarRef.current?.click()}
                                disabled={uploadingAvatar}
                                aria-label="Change avatar"
                                className="absolute -bottom-1 -right-1 bg-green-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-green-800 disabled:opacity-50"
                            >
                                {uploadingAvatar ? '…' : '✏'}
                            </button>
                            <input
                                ref={avatarRef}
                                type="file"
                                accept="image/*"
                                title="Upload avatar image"
                                className="hidden"
                                onChange={handleAvatarChange}
                            />
                        </div>
                        <div>
                            <p className="text-lg font-semibold text-gray-900">{profile.name}</p>
                            <p className="text-sm text-gray-500">{profile.email}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize">{profile.role}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${kycColor}`}>{t(kycLabelKey)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label htmlFor="profile-name" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.fullName')}</label>
                            <input
                                id="profile-name"
                                type="text"
                                suppressHydrationWarning
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Your full name"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="profile-phone" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.phone')}</label>
                            <input
                                id="profile-phone"
                                type="tel"
                                suppressHydrationWarning
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="+91 XXXXXXXXXX"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <div>
                            <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700 mb-1">{t('profile.email')}</label>
                            <input
                                id="profile-email"
                                type="email"
                                suppressHydrationWarning
                                value={profile.email}
                                disabled
                                title="Email address (cannot be changed)"
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500"
                            />
                        </div>
                        <button
                            type="button"
                            suppressHydrationWarning
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full bg-green-700 text-white py-2.5 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
                        >
                            {saving ? t('profile.saving') : t('profile.saveChanges')}
                        </button>
                    </div>
                </div>

                {/* Password change */}
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <button
                        type="button"
                        suppressHydrationWarning
                        onClick={() => setShowPwd(v => !v)}
                        className="flex items-center justify-between w-full"
                    >
                        <span className="font-semibold text-gray-900">{t('profile.changePassword')}</span>
                        <span className="text-gray-400 text-sm">{showPwd ? '▲ Hide' : '▼ Show'}</span>
                    </button>

                    {showPwd && (
                        <div className="mt-4 space-y-4">
                            <p className="text-xs text-gray-500">{t('profile.passwordHint')}</p>
                            {[
                                { id: 'pwd-current', label: t('profile.currentPassword'),    value: currentPwd, set: setCurrentPwd },
                                { id: 'pwd-new',     label: t('profile.newPassword'),         value: newPwd,     set: setNewPwd },
                                { id: 'pwd-confirm', label: t('profile.confirmNewPassword'),  value: confirmPwd, set: setConfirmPwd },
                            ].map(({ id, label, value, set }) => (
                                <div key={id}>
                                    <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                                    <input
                                        id={id}
                                        type="password"
                                        suppressHydrationWarning
                                        value={value}
                                        placeholder="••••••••"
                                        onChange={e => set(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                </div>
                            ))}
                            <button
                                type="button"
                                suppressHydrationWarning
                                onClick={handleChangePassword}
                                disabled={changingPwd}
                                className="w-full bg-gray-800 text-white py-2.5 rounded-lg font-medium hover:bg-gray-900 disabled:opacity-50 transition-colors"
                            >
                                {changingPwd ? t('common.loading') : t('profile.updatePassword')}
                            </button>
                        </div>
                    )}
                </div>

                {/* KYC section */}
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <h2 className="font-semibold text-gray-900 mb-1">{t('profile.kycStatus')}</h2>
                    <p className="text-sm text-gray-500 mb-4">
                        {t('profile.kycDesc')}
                    </p>
                    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${kycColor}`}>
                        {t(kycLabelKey)}
                    </div>
                    {(profile.kyc_status === 'unverified' || profile.kyc_status === 'rejected' || !profile.kyc_status) && (
                        <p className="text-sm text-gray-500 mt-3">
                            {t('profile.kycGoTo')}{' '}
                            <a href="/kyc" className="text-green-700 underline">{t('profile.kycDocuments')}</a>{' '}
                            {t('profile.kycUploadHint')}
                        </p>
                    )}
                </div>

                {/* Account info */}
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <h2 className="font-semibold text-gray-900 mb-3">{t('profile.editProfile')}</h2>
                    <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <dt className="text-gray-500">User ID</dt>
                            <dd className="text-gray-700 font-mono text-xs">{profile.id}</dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-gray-500">{t('profile.role')}</dt>
                            <dd className="text-gray-700 capitalize">{profile.role}</dd>
                        </div>
                        {profile.created_at && (
                            <div className="flex justify-between">
                                <dt className="text-gray-500">{t('profile.memberSince')}</dt>
                                <dd className="text-gray-700">
                                    {new Date(profile.created_at).toLocaleDateString('en-IN', {
                                        year: 'numeric', month: 'long', day: 'numeric',
                                    })}
                                </dd>
                            </div>
                        )}
                    </dl>
                </div>
            </div>
        </div>
    );
}

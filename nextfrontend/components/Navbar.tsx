'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Tractor, Menu, X, Heart, Tag, ChevronDown, LogOut, Settings, LayoutDashboard, PlusCircle, BookOpen, MessageSquare, Wallet, Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import NotificationBell from '@/components/NotificationBell';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { nodeApi } from '@/lib/api';
import { cn } from '@/lib/utils';

function useWishlistCount(isAuthenticated: boolean) {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!isAuthenticated) { setCount(0); return; }
        nodeApi.get<any>('/favorites/ids').then(r => setCount((r?.ids ?? []).length)).catch(() => {});
    }, [isAuthenticated]);
    return count;
}

function ProfileDropdown({ user, onLogout }: { user: any; onLogout: () => void }) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const dashboardHref = user?.role === 'owner' ? '/dashboard/owner'
        : user?.role === 'admin' ? '/dashboard/admin'
        : '/dashboard/farmer';

    const initial = user?.name?.[0]?.toUpperCase() || 'U';

    return (
        <div className="relative" ref={ref}>
            <button type="button" suppressHydrationWarning
                onClick={() => setOpen(!open)}
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-gray-100 transition-colors">
                <div className="bg-gradient-to-br from-green-100 to-emerald-200 rounded-full h-8 w-8 flex items-center justify-center text-green-700 font-bold text-sm">
                    {initial}
                </div>
                <span className="text-sm font-semibold text-gray-700 hidden lg:block">{user?.name?.split(' ')[0]}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50">
                    {/* User info */}
                    <div className="px-4 py-3 border-b border-gray-100">
                        <p className="font-bold text-gray-900 text-sm">{user?.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                    </div>

                    <div className="py-1">
                        <Link href={dashboardHref} onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <LayoutDashboard className="h-4 w-4 text-green-600" /> {t('nav.dashboard')}
                        </Link>
                        <Link href="/bookings" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <BookOpen className="h-4 w-4 text-blue-600" /> {t('nav.bookings')}
                        </Link>
                        <Link href="/chats" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <MessageSquare className="h-4 w-4 text-green-600" /> {t('nav.messages')}
                        </Link>
                        <Link href="/wallet" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <Wallet className="h-4 w-4 text-yellow-600" /> FarmWallet
                        </Link>
                        <Link href="/notifications" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <Bell className="h-4 w-4 text-purple-600" /> Notifications
                        </Link>
                        <Link href="/offers" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <Tag className="h-4 w-4 text-indigo-600" /> {t('nav.offers')}
                        </Link>
                        {user?.role === 'owner' && (
                            <Link href="/add-equipment" onClick={() => setOpen(false)}
                                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                                <PlusCircle className="h-4 w-4 text-emerald-600" /> {t('nav.addEquipment')}
                            </Link>
                        )}
                        <Link href="/dashboard/profile" onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                            <Settings className="h-4 w-4 text-gray-500" /> {t('nav.settings')}
                        </Link>
                    </div>

                    <div className="border-t border-gray-100 py-1">
                        <button type="button" suppressHydrationWarning onClick={() => { setOpen(false); onLogout(); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                            <LogOut className="h-4 w-4" /> {t('nav.logout')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function Navbar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user, logout, isAuthenticated } = useAuth();
    const { t } = useLanguage();
    const [mobileOpen, setMobileOpen] = useState(false);
    const wishlistCount = useWishlistCount(isAuthenticated);

    const handleLogout = async () => {
        await logout();
        router.push('/login');
        setMobileOpen(false);
    };

    const isActive = (href: string) => pathname.startsWith(href);

    const mainLinks = [
        { href: '/browse',       label: t('nav.browse') },
        { href: '/ai-assistant', label: t('nav.aiAssistant') },
        { href: '/how-it-works', label: t('nav.howItWorks') },
    ];

    const dashboardHref = user?.role === 'owner' ? '/dashboard/owner'
        : user?.role === 'admin' ? '/dashboard/admin'
        : '/dashboard/farmer';

    return (
        <>
            <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 max-w-screen-xl">
                    <div className="flex items-center justify-between h-16 gap-4">
                        {/* Logo */}
                        <Link href="/" className="flex items-center gap-2 flex-shrink-0">
                            <div className="bg-green-700 rounded-xl p-2 shadow-sm">
                                <Tractor className="h-5 w-5 text-white" />
                            </div>
                            <span className="text-xl font-black text-green-700">FarmRent</span>
                        </Link>

                        {/* Desktop nav links */}
                        <div className="hidden md:flex items-center gap-1">
                            {mainLinks.map(link => (
                                <Link key={link.href} href={link.href}
                                    className={cn('px-3 py-2 rounded-xl text-sm font-semibold transition-colors',
                                        isActive(link.href)
                                            ? 'bg-green-50 text-green-700'
                                            : 'text-gray-600 hover:text-green-700 hover:bg-gray-50')}>
                                    {link.label}
                                </Link>
                            ))}
                            {isAuthenticated && (
                                <Link href={dashboardHref}
                                    className={cn('px-3 py-2 rounded-xl text-sm font-semibold transition-colors',
                                        isActive('/dashboard')
                                            ? 'bg-green-50 text-green-700'
                                            : 'text-gray-600 hover:text-green-700 hover:bg-gray-50')}>
                                    {t('nav.dashboard')}
                                </Link>
                            )}
                        </div>

                        {/* Right side actions */}
                        <div className="hidden md:flex items-center gap-2">
                            <LanguageSwitcher />
                            {isAuthenticated ? (
                                <>
                                    {/* Wishlist */}
                                    <Link href="/wishlist" aria-label={`Wishlist${wishlistCount > 0 ? `, ${wishlistCount} items` : ''}`}
                                        className="relative h-9 w-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                                        <Heart className={cn('h-5 w-5', wishlistCount > 0 ? 'text-red-500 fill-red-500' : 'text-gray-500')} />
                                        {wishlistCount > 0 && (
                                            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-black rounded-full h-4 w-4 flex items-center justify-center leading-none">
                                                {wishlistCount > 9 ? '9+' : wishlistCount}
                                            </span>
                                        )}
                                    </Link>

                                    <NotificationBell />

                                    <ProfileDropdown user={user} onLogout={handleLogout} />
                                </>
                            ) : (
                                <>
                                    <Link href="/login"><Button variant="ghost" size="sm" className="font-semibold">{t('nav.login')}</Button></Link>
                                    <Link href="/register"><Button size="sm" className="bg-green-700 hover:bg-green-800 font-bold rounded-xl">{t('nav.register')}</Button></Link>
                                </>
                            )}
                        </div>

                        {/* Mobile right: wishlist + hamburger */}
                        <div className="md:hidden flex items-center gap-1">
                            {isAuthenticated && (
                                <Link href="/wishlist" aria-label="Wishlist" className="relative h-9 w-9 flex items-center justify-center rounded-xl hover:bg-gray-100">
                                    <Heart className={cn('h-5 w-5', wishlistCount > 0 ? 'text-red-500 fill-red-500' : 'text-gray-500')} />
                                    {wishlistCount > 0 && (
                                        <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-black rounded-full h-4 w-4 flex items-center justify-center">
                                            {wishlistCount > 9 ? '9+' : wishlistCount}
                                        </span>
                                    )}
                                </Link>
                            )}
                            <button type="button" suppressHydrationWarning aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                                className="h-9 w-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
                                onClick={() => setMobileOpen(!mobileOpen)}>
                                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Mobile drawer overlay */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 md:hidden">
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
                    <div className="absolute inset-y-0 right-0 w-72 bg-white shadow-2xl flex flex-col">
                        {/* Drawer header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                            <span className="font-black text-green-700 text-lg">FarmRent</span>
                            <button type="button" suppressHydrationWarning aria-label="Close menu"
                                onClick={() => setMobileOpen(false)}
                                className="h-8 w-8 flex items-center justify-center rounded-xl hover:bg-gray-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* User info */}
                        {isAuthenticated && user && (
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
                                <div className="bg-gradient-to-br from-green-100 to-emerald-200 rounded-full h-10 w-10 flex items-center justify-center text-green-700 font-bold">
                                    {user.name?.[0]?.toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-bold text-gray-900 text-sm">{user.name}</p>
                                    <p className="text-xs text-gray-400 capitalize">{user.role}</p>
                                </div>
                            </div>
                        )}

                        {/* Nav links */}
                        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
                            {mainLinks.map(link => (
                                <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)}
                                    className={cn('flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold transition-colors',
                                        isActive(link.href) ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50')}>
                                    {link.label}
                                </Link>
                            ))}
                            {isAuthenticated && (
                                <>
                                    <Link href={dashboardHref} onClick={() => setMobileOpen(false)}
                                        className={cn('flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold',
                                            isActive('/dashboard') ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50')}>
                                        <LayoutDashboard className="h-4 w-4" /> {t('nav.dashboard')}
                                    </Link>
                                    <Link href="/bookings" onClick={() => setMobileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <BookOpen className="h-4 w-4 text-blue-600" /> {t('nav.bookings')}
                                    </Link>
                                    <Link href="/chats" onClick={() => setMobileOpen(false)}
                                        className={cn('flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold',
                                            isActive('/chats') ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50')}>
                                        <MessageSquare className="h-4 w-4 text-green-600" /> {t('nav.messages')}
                                    </Link>
                                    <Link href="/wallet" onClick={() => setMobileOpen(false)}
                                        className={cn('flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold',
                                            isActive('/wallet') ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50')}>
                                        <Wallet className="h-4 w-4 text-yellow-600" /> FarmWallet
                                    </Link>
                                    <Link href="/notifications" onClick={() => setMobileOpen(false)}
                                        className={cn('flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold',
                                            isActive('/notifications') ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50')}>
                                        <Bell className="h-4 w-4 text-purple-600" /> Notifications
                                    </Link>
                                    <Link href="/wishlist" onClick={() => setMobileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Heart className="h-4 w-4 text-red-500" /> {t('nav.wishlist')}
                                        {wishlistCount > 0 && (
                                            <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{wishlistCount}</span>
                                        )}
                                    </Link>
                                    <Link href="/offers" onClick={() => setMobileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Tag className="h-4 w-4 text-indigo-600" /> {t('nav.offers')}
                                    </Link>
                                    {user?.role === 'owner' && (
                                        <Link href="/add-equipment" onClick={() => setMobileOpen(false)}
                                            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                            <PlusCircle className="h-4 w-4 text-emerald-600" /> {t('nav.addEquipment')}
                                        </Link>
                                    )}
                                    <Link href="/dashboard/profile" onClick={() => setMobileOpen(false)}
                                        className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50">
                                        <Settings className="h-4 w-4 text-gray-500" /> {t('nav.settings')}
                                    </Link>
                                </>
                            )}
                        </div>

                        {/* Language switcher (mobile) */}
                        <div className="px-4 pb-2 border-t border-gray-100 pt-3">
                            <LanguageSwitcher />
                        </div>

                        {/* Bottom auth */}
                        <div className="px-4 py-4 border-t border-gray-100">
                            {isAuthenticated ? (
                                <button type="button" suppressHydrationWarning onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-red-200 text-red-600 text-sm font-bold hover:bg-red-50 transition-colors">
                                    <LogOut className="h-4 w-4" /> {t('nav.logout')}
                                </button>
                            ) : (
                                <div className="flex gap-2">
                                    <Link href="/login" className="flex-1" onClick={() => setMobileOpen(false)}>
                                        <Button variant="outline" className="w-full font-semibold">{t('nav.login')}</Button>
                                    </Link>
                                    <Link href="/register" className="flex-1" onClick={() => setMobileOpen(false)}>
                                        <Button className="w-full bg-green-700 hover:bg-green-800 font-bold">{t('nav.register')}</Button>
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

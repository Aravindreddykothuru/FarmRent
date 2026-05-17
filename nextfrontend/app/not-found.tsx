'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Home, Search } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function NotFound() {
    const { t } = useLanguage();
    return (
        <div className="min-h-[80vh] flex items-center justify-center bg-[#F7F8FA] px-4">
            <div className="text-center max-w-lg">
                {/* Illustration */}
                <div className="relative inline-block mb-6">
                    <div className="text-[100px] leading-none select-none">🚜</div>
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-green-100 rounded-full w-24 h-4 blur-sm" />
                </div>

                {/* Text */}
                <div className="mb-2">
                    <span className="text-8xl font-black text-green-200 select-none">404</span>
                </div>
                <h1 className="text-2xl font-black text-gray-900 mb-3">{t('notFound.title')}</h1>
                <p className="text-gray-500 text-base leading-relaxed mb-8 max-w-sm mx-auto">
                    {t('notFound.desc')}
                </p>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
                    <Link href="/">
                        <Button className="bg-green-700 hover:bg-green-800 rounded-xl font-bold gap-2 w-full sm:w-auto">
                            <Home className="h-4 w-4" /> {t('notFound.goHome')}
                        </Button>
                    </Link>
                    <Link href="/browse">
                        <Button variant="outline" className="rounded-xl font-bold gap-2 w-full sm:w-auto border-gray-200">
                            <Search className="h-4 w-4" /> {t('home.browseEquipment')}
                        </Button>
                    </Link>
                </div>

                {/* Quick links */}
                <div className="border-t border-gray-100 pt-7">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-3">{t('notFound.quickLinks')}</p>
                    <div className="flex flex-wrap justify-center gap-3">
                        {[
                            { href: '/login',        label: t('auth.signIn') },
                            { href: '/register',     label: t('nav.register') },
                            { href: '/how-it-works', label: t('nav.howItWorks') },
                            { href: '/ai-assistant', label: t('nav.aiAssistant') },
                        ].map(l => (
                            <Link
                                key={l.href}
                                href={l.href}
                                className="text-xs font-medium text-green-700 hover:text-green-900 bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-full transition-colors"
                            >
                                {l.label}
                            </Link>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

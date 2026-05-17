'use client';

import Link from 'next/link';
import { Tractor, MapPin, Phone, Mail, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const STATES = ['Telangana', 'Andhra Pradesh', 'Maharashtra', 'Karnataka', 'Tamil Nadu', 'Punjab', 'Haryana', 'Uttar Pradesh'];

export default function Footer() {
    const { t } = useLanguage();
    const year = new Date().getFullYear();

    const LINKS = {
        [t('footer.explore')]: [
            { href: '/browse',             label: t('footer.browseEquipment') },
            { href: '/ai-assistant',       label: t('footer.aiAssistant') },
            { href: '/how-it-works',       label: t('footer.howItWorks') },
            { href: '/browse?sort=rating', label: t('footer.topRated') },
        ],
        [t('footer.forOwners')]: [
            { href: '/add-equipment',   label: t('footer.listEquipment') },
            { href: '/dashboard/owner', label: t('footer.ownerDashboard') },
            { href: '/how-it-works',    label: t('footer.pricingGuide') },
            { href: '/register',        label: t('footer.becomeOwner') },
        ],
        [t('footer.account')]: [
            { href: '/login',             label: t('footer.signIn') },
            { href: '/register',          label: t('footer.createAccount') },
            { href: '/dashboard/profile', label: t('footer.myProfile') },
            { href: '/bookings',          label: t('footer.myBookings') },
        ],
    };

    return (
        <footer className="bg-gray-950 text-gray-300">
            {/* ── Top CTA strip ─────────────────────────────────────────── */}
            <div className="bg-green-700">
                <div className="container mx-auto px-4 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                        <p className="font-black text-white text-lg">{t('footer.cta')}</p>
                        <p className="text-green-200 text-sm">{t('footer.ctaSub')}</p>
                    </div>
                    <Link
                        href="/register"
                        className="flex items-center gap-2 bg-white text-green-700 font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-green-50 transition-colors flex-shrink-0"
                    >
                        {t('footer.getStarted')} <ArrowRight className="h-4 w-4" />
                    </Link>
                </div>
            </div>

            {/* ── Main footer grid ──────────────────────────────────────── */}
            <div className="container mx-auto px-4 lg:px-8 py-12">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10">

                    {/* Brand column */}
                    <div className="lg:col-span-2">
                        <Link href="/" className="flex items-center gap-2 mb-4">
                            <div className="bg-green-600 rounded-xl p-2 shadow">
                                <Tractor className="h-5 w-5 text-white" />
                            </div>
                            <span className="text-xl font-black text-white">FarmRent</span>
                        </Link>
                        <p className="text-sm text-gray-400 leading-relaxed max-w-xs mb-5">
                            {t('footer.tagline')}
                        </p>

                        {/* Contact */}
                        <div className="space-y-2 text-sm">
                            <div className="flex items-center gap-2 text-gray-400">
                                <MapPin className="h-4 w-4 text-green-500 flex-shrink-0" />
                                <span>Hyderabad, Telangana, India</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-400">
                                <Phone className="h-4 w-4 text-green-500 flex-shrink-0" />
                                <span>+91 98765 43210</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-400">
                                <Mail className="h-4 w-4 text-green-500 flex-shrink-0" />
                                <span>support@farmrent.in</span>
                            </div>
                        </div>
                    </div>

                    {/* Link columns */}
                    {Object.entries(LINKS).map(([heading, items]) => (
                        <div key={heading}>
                            <h4 className="text-white font-bold text-sm mb-4 uppercase tracking-wider">{heading}</h4>
                            <ul className="space-y-2.5">
                                {items.map(item => (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className="text-sm text-gray-400 hover:text-green-400 transition-colors"
                                        >
                                            {item.label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* States served */}
                <div className="mt-10 pt-8 border-t border-gray-800">
                    <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider font-semibold">{t('footer.statesCovered')}</p>
                    <div className="flex flex-wrap gap-2">
                        {STATES.map(s => (
                            <span key={s} className="text-xs bg-gray-800 text-gray-400 px-3 py-1 rounded-full">{s}</span>
                        ))}
                        <span className="text-xs bg-gray-800 text-green-500 px-3 py-1 rounded-full font-semibold">{t('footer.moreStates')}</span>
                    </div>
                </div>
            </div>

            {/* ── Bottom bar ────────────────────────────────────────────── */}
            <div className="border-t border-gray-800">
                <div className="container mx-auto px-4 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
                    <p>{t('footer.copyright', { year: String(year) })}</p>
                    <div className="flex items-center gap-4">
                        <Link href="/" className="hover:text-gray-300 transition-colors">{t('footer.privacyPolicy')}</Link>
                        <Link href="/" className="hover:text-gray-300 transition-colors">{t('footer.termsOfService')}</Link>
                        <Link href="/" className="hover:text-gray-300 transition-colors">{t('footer.refundPolicy')}</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
}

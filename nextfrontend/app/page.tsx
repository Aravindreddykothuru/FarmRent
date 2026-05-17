'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import EquipmentCard, { type EquipmentCardData } from '@/components/EquipmentCard';
import {
    Search, MapPin, Navigation, Loader2, ChevronRight,
    TrendingUp, Shield, Clock, Star, Tractor, Zap,
    ArrowRight, CheckCircle, IndianRupee, Quote,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

const CATEGORIES = [
    { id: 'tractor',           labelKey: 'equipment.tractor',   icon: '🚜', descKey: 'home.step1Title' },
    { id: 'combine-harvester', labelKey: 'equipment.harvester', icon: '🌾', descKey: 'home.step2Title' },
    { id: 'rotavator',         labelKey: 'equipment.rotavator', icon: '⚙️',  descKey: 'home.step1Title' },
    { id: 'boom-sprayer',      labelKey: 'equipment.sprayer',   icon: '💧', descKey: 'home.step1Title' },
    { id: 'seed-drill',        labelKey: 'equipment.seedDrill', icon: '🌱', descKey: 'home.step1Title' },
    { id: 'thresher',          labelKey: 'equipment.thresher',  icon: '🌀', descKey: 'home.step1Title' },
    { id: 'water-pump',        labelKey: 'equipment.waterPump', icon: '🔧', descKey: 'home.step1Title' },
    { id: 'power-tiller',      labelKey: 'equipment.tiller',    icon: '🔩', descKey: 'home.step1Title' },
];

const POPULAR_SEARCHES = ['Mahindra Tractor', 'Paddy Harvester', 'Rotavator 45 HP', 'Boom Sprayer', 'Seed Drill'];

function EquipmentCardSkeleton() {
    return (
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-100">
            <Skeleton className="h-44 w-full" />
            <div className="p-4 space-y-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-4 w-1/3 mt-1" />
            </div>
        </div>
    );
}

export default function HomePage() {
    const router = useRouter();
    const { user, isAuthenticated } = useAuth();
    const { t } = useLanguage();
    const { state: geoState, request: requestLocation } = useGeolocation();
    const [search, setSearch]           = useState('');
    const [featured, setFeatured]       = useState<EquipmentCardData[]>([]);
    const [nearby, setNearby]           = useState<EquipmentCardData[]>([]);
    const [loadingFeatured, setLF]      = useState(true);
    const [loadingNearby, setLN]        = useState(false);
    const [stats, setStats]             = useState({ machines: 0, renters: 0, states: 0, bookings: 0 });

    useEffect(() => {
        nodeApi.get<any>('/machines?status=available&sort=rating&limit=8')
            .then(r => setFeatured(r?.data?.machines ?? r?.machines ?? r?.data ?? []))
            .catch(() => setFeatured([]))
            .finally(() => setLF(false));

        nodeApi.get<any>('/admin/dashboard').then(r => {
            const d = r?.data;
            if (d) setStats({
                machines: d.total_equipment ?? d.machines ?? 0,
                renters:  d.total_users     ?? d.farmers  ?? 0,
                states:   d.states          ?? 15,
                bookings: d.total_bookings  ?? d.bookings ?? 0,
            });
        }).catch(() => {});
    }, []);

    useEffect(() => {
        if (geoState.status !== 'resolved') return;
        setLN(true);
        nodeApi.get<any>(`/machines?status=available&sort=distance&lat=${geoState.position.lat}&lng=${geoState.position.lng}&limit=6`)
            .then(r => setNearby(r?.data?.machines ?? r?.machines ?? r?.data ?? []))
            .catch(() => setNearby([]))
            .finally(() => setLN(false));
    }, [geoState.status]);

    const locLabel = geoState.status === 'resolved'
        ? (geoState.position.address?.district || geoState.position.address?.village || 'Your Area')
        : null;

    const heroEquipment = featured[0];
    const gridEquipment = featured.slice(1);

    const HOW_IT_WORKS = [
        { step: '01', icon: Search,      title: t('home.step1Title'), desc: t('home.step1Desc') },
        { step: '02', icon: CheckCircle, title: t('home.step2Title'), desc: t('home.step2Desc') },
        { step: '03', icon: Navigation,  title: t('home.step3Title'), desc: t('home.step3Desc') },
        { step: '04', icon: Star,        title: t('home.step4Title'), desc: t('home.step4Desc') },
    ];

    const TRUST_BADGES = [
        { icon: Shield,     label: t('home.securePayments'),  desc: t('home.securePaymentsDesc'),  color: 'bg-blue-50 text-blue-600' },
        { icon: TrendingUp, label: t('home.verifiedOwners'),  desc: t('home.verifiedOwnersDesc'),  color: 'bg-purple-50 text-purple-600' },
        { icon: Clock,      label: t('home.support247'),      desc: t('home.support247Desc'),      color: 'bg-amber-50 text-amber-600' },
        { icon: Zap,        label: t('home.liveTracking'),    desc: t('home.liveTrackingDesc'),    color: 'bg-green-50 text-green-600' },
    ];

    return (
        <div className="min-h-screen bg-[#F7F8FA]">

            {/* ══════════════════════════════════ HERO ══ */}
            <section className="relative bg-gradient-to-br from-green-950 via-green-900 to-green-800 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.07] hero-pattern" />
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-yellow-400/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-green-400/10 rounded-full blur-2xl pointer-events-none" />

                <div className="container mx-auto px-4 lg:px-8 py-14 lg:py-24 relative z-10">
                    <div className="max-w-2xl">
                        {/* Badge */}
                        <div className="flex items-center gap-2.5 mb-6 animate-fade-in-up">
                            <span className="bg-yellow-400 text-yellow-950 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-widest">
                                🇮🇳 {t('home.indiaTop')}
                            </span>
                            <span className="text-green-300 text-sm font-medium">{t('home.agriMarket')}</span>
                            <span className="flex items-center gap-1 text-[10px] font-bold text-green-300 border border-green-700 rounded-full px-2 py-0.5">
                                <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                                LIVE
                            </span>
                        </div>

                        <h1 className="text-4xl lg:text-5xl xl:text-6xl font-black text-white leading-[1.08] mb-5 animate-fade-in-up animation-delay-100">
                            {t('home.heroLine1')}<br />
                            <span className="text-yellow-400">{t('home.heroLine2')}</span><br />
                            <span className="text-green-300 text-3xl lg:text-4xl font-extrabold">{t('home.heroLine3')}</span>
                        </h1>

                        <p className="text-green-100 text-base lg:text-lg mb-8 max-w-lg leading-relaxed animate-fade-in-up animation-delay-200">
                            {t('home.heroSubtitle')}
                        </p>

                        {/* Search */}
                        <form
                            onSubmit={e => {
                                e.preventDefault();
                                router.push(search.trim() ? `/browse?q=${encodeURIComponent(search.trim())}` : '/browse');
                            }}
                            className="flex gap-2 max-w-lg animate-fade-in-up animation-delay-300"
                        >
                            <div className="relative flex-1">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                <Input
                                    placeholder={t('home.searchPlaceholder')}
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className="h-14 pl-12 pr-4 rounded-2xl text-base border-0 shadow-xl bg-white focus-visible:ring-2 focus-visible:ring-yellow-400"
                                />
                            </div>
                            <Button type="submit" size="lg" className="h-14 px-6 rounded-2xl bg-yellow-400 hover:bg-yellow-300 text-yellow-950 font-bold shadow-xl text-base flex-shrink-0">
                                {t('home.search')}
                            </Button>
                        </form>

                        {/* Popular searches */}
                        <div className="mt-4 flex flex-wrap gap-2 animate-fade-in-up animation-delay-400">
                            {POPULAR_SEARCHES.map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    suppressHydrationWarning
                                    onClick={() => router.push(`/browse?q=${encodeURIComponent(s)}`)}
                                    className="text-[11px] font-medium text-green-200 border border-green-700 hover:border-green-400 hover:text-white rounded-full px-3 py-1 transition-colors"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>

                        {/* Location detect */}
                        <button
                            type="button"
                            suppressHydrationWarning
                            onClick={requestLocation}
                            className={cn(
                                'mt-5 flex items-center gap-2 text-sm font-medium transition-colors',
                                geoState.status === 'resolved' ? 'text-yellow-300' : 'text-green-300 hover:text-white'
                            )}
                        >
                            {geoState.status === 'requesting'
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <MapPin className="h-4 w-4" />}
                            {geoState.status === 'resolved'
                                ? t('home.showingNear', { location: locLabel ?? '' })
                                : t('home.useLocation')}
                        </button>
                    </div>
                </div>

                {/* Hero equipment card — desktop */}
                {heroEquipment && !loadingFeatured && (
                    <div className="hidden xl:block absolute right-16 bottom-0 top-8 w-72">
                        <Link href={`/equipment/${heroEquipment._id ?? heroEquipment.id}`}>
                            <div className="glass rounded-3xl overflow-hidden h-full max-h-80 hover:bg-white/20 transition-all">
                                {heroEquipment.images?.[0] && (
                                    <img
                                        src={heroEquipment.images[0]}
                                        alt={heroEquipment.name}
                                        className="w-full h-48 object-cover"
                                    />
                                )}
                                <div className="p-4 text-white">
                                    <Badge className="bg-yellow-400 text-yellow-950 border-0 text-[10px] mb-2 capitalize">
                                        {heroEquipment.type?.replace(/-/g, ' ')}
                                    </Badge>
                                    <p className="font-bold text-base leading-tight">{heroEquipment.name}</p>
                                    <div className="flex items-baseline gap-1 mt-2 text-yellow-300">
                                        <IndianRupee className="h-3.5 w-3.5" />
                                        <span className="font-black text-xl">
                                            {(heroEquipment.pricing?.baseRatePerDay ?? 0).toLocaleString('en-IN')}
                                        </span>
                                        <span className="text-white/60 text-xs">{t('home.perDay')}</span>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    </div>
                )}
            </section>

            {/* ══════════════════════════════════ STATS ══ */}
            <section className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100">
                        {[
                            { value: stats.machines > 0 ? `${stats.machines}+` : '500+',   label: t('home.equipmentListed'), icon: '🚜' },
                            { value: stats.renters  > 0 ? `${stats.renters}+`  : '2,000+', label: t('home.farmerServed'),    icon: '👨‍🌾' },
                            { value: stats.bookings > 0 ? `${stats.bookings}+` : '3,500+', label: t('home.bookingsMade'),    icon: '📋' },
                            { value: '15+',                                                  label: t('home.statesCovered'),   icon: '📍' },
                        ].map(s => (
                            <div key={s.label} className="py-5 px-4 text-center group">
                                <div className="text-2xl mb-1">{s.icon}</div>
                                <p className="text-2xl lg:text-3xl font-black text-green-700">{s.value}</p>
                                <p className="text-xs text-gray-500 mt-0.5 font-medium">{s.label}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <div className="container mx-auto px-4 lg:px-8 py-10 space-y-14">

                {/* ══════════════════════════════════ CATEGORIES ══ */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-2xl font-black text-gray-900">{t('home.browseByCategory')}</h2>
                            <p className="text-gray-500 text-sm mt-0.5">{t('home.findEquipment')}</p>
                        </div>
                        <Link href="/browse" className="flex items-center gap-1 text-green-700 text-sm font-bold hover:gap-2 transition-all">
                            {t('home.viewAll')} <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 sm:grid sm:grid-cols-4 lg:grid-cols-8 sm:pb-0">
                        {CATEGORIES.map(cat => (
                            <Link key={cat.id} href={`/browse?category=${cat.id}`} className="flex-shrink-0 sm:flex-shrink w-[110px] sm:w-auto">
                                <div className="group bg-white rounded-2xl p-4 text-center border border-gray-100 hover:border-green-300 hover:bg-green-50 hover:shadow-md transition-all duration-200 cursor-pointer h-full">
                                    <div className="text-3xl mb-2">{cat.icon}</div>
                                    <p className="text-xs font-bold text-gray-800 group-hover:text-green-700 transition-colors leading-tight">
                                        {t(cat.labelKey)}
                                    </p>
                                </div>
                            </Link>
                        ))}
                    </div>
                </section>

                {/* ══════════════════════════════════ NEARBY ══ */}
                {(geoState.status === 'resolved' || geoState.status === 'requesting' || loadingNearby) && (
                    <section>
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-black text-gray-900">
                                    {geoState.status === 'requesting'
                                        ? t('home.findingNearby')
                                        : t('home.nearYou', { location: locLabel ?? '' })}
                                </h2>
                                <p className="text-gray-500 text-sm mt-0.5">{t('home.nearbySubtitle')}</p>
                            </div>
                            <Link href="/browse?sort=distance" className="flex items-center gap-1 text-green-700 text-sm font-bold hover:gap-2 transition-all">
                                {t('home.seeAll')} <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                        {loadingNearby ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {[...Array(4)].map((_, i) => <EquipmentCardSkeleton key={i} />)}
                            </div>
                        ) : nearby.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {nearby.map(m => <EquipmentCard key={m._id ?? m.id} machine={m} />)}
                            </div>
                        ) : null}
                    </section>
                )}

                {/* ══════════════════════════════════ FEATURED ══ */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-2xl font-black text-gray-900">{t('home.topRated')}</h2>
                            <p className="text-gray-500 text-sm mt-0.5">{t('home.highlyRated')}</p>
                        </div>
                        <Link href="/browse?sort=rating" className="flex items-center gap-1 text-green-700 text-sm font-bold hover:gap-2 transition-all">
                            {t('home.seeAll')} <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                    {loadingFeatured ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {[...Array(8)].map((_, i) => <EquipmentCardSkeleton key={i} />)}
                        </div>
                    ) : gridEquipment.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {gridEquipment.map(m => <EquipmentCard key={m._id ?? m.id} machine={m} variant="featured" />)}
                        </div>
                    ) : (
                        <div className="text-center py-16 bg-white rounded-3xl border border-gray-100">
                            <div className="text-5xl mb-3">🚜</div>
                            <p className="text-gray-500 font-medium">{t('home.noEquipment')}</p>
                            <p className="text-gray-400 text-sm mt-1">{t('home.newListingsDaily')}</p>
                        </div>
                    )}
                </section>

                {/* ══════════════════════════════════ TRUST ══ */}
                <section className="bg-white rounded-3xl p-8 lg:p-10 border border-gray-100 shadow-sm">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-black text-gray-900">{t('home.whyChoose')}</h2>
                        <p className="text-gray-500 text-sm mt-1">{t('home.builtFor')}</p>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                        {TRUST_BADGES.map(b => (
                            <div key={b.label} className="text-center group">
                                <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 transition-transform group-hover:scale-110', b.color)}>
                                    <b.icon className="h-6 w-6" />
                                </div>
                                <p className="font-bold text-gray-900 text-sm">{b.label}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{b.desc}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ══════════════════════════════════ HOW IT WORKS ══ */}
                <section>
                    <div className="text-center mb-8">
                        <Badge className="bg-green-100 text-green-700 border-0 mb-3">{t('home.simpleProcess')}</Badge>
                        <h2 className="text-2xl font-black text-gray-900">{t('home.howItWorks')}</h2>
                        <p className="text-gray-500 text-sm mt-1">{t('home.howItWorksSubtitle')}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {HOW_IT_WORKS.map((s, i) => (
                            <div key={s.step} className="relative">
                                {i < HOW_IT_WORKS.length - 1 && (
                                    <div className="hidden lg:block absolute top-7 left-[calc(100%+10px)] w-[calc(100%-20px)] h-0.5 bg-gradient-to-r from-green-200 to-green-100 z-0" />
                                )}
                                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative z-10 hover:shadow-md hover:border-green-200 hover:-translate-y-0.5 transition-all duration-200">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="w-11 h-11 rounded-xl bg-green-700 flex items-center justify-center shadow-sm">
                                            <s.icon className="h-5 w-5 text-white" />
                                        </div>
                                        <span className="text-4xl font-black text-gray-100">{s.step}</span>
                                    </div>
                                    <p className="font-bold text-gray-900 mb-1.5">{s.title}</p>
                                    <p className="text-xs text-gray-500 leading-relaxed">{s.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="text-center mt-6">
                        <Link href="/how-it-works">
                            <Button variant="outline" className="rounded-xl font-semibold">
                                {t('home.learnMore')} <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        </Link>
                    </div>
                </section>

                {/* ══════════════════════════════════ DUAL CTA ══ */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Farmer CTA */}
                    <div className="relative bg-gradient-to-br from-blue-700 to-blue-600 rounded-3xl p-7 text-white shadow-lg overflow-hidden">
                        <div className="absolute -right-6 -bottom-6 text-[120px] opacity-10 select-none">🌾</div>
                        <div className="absolute top-4 right-4">
                            <Badge className="bg-blue-500/50 text-white border-0 text-[10px]">{t('home.forFarmers')}</Badge>
                        </div>
                        <div className="relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
                                <Tractor className="h-6 w-6 text-white" />
                            </div>
                            <h3 className="text-2xl font-black mb-2">{t('home.rentToday')}</h3>
                            <p className="text-blue-100 text-sm leading-relaxed mb-5">{t('home.rentTodayDesc')}</p>
                            <Link href={isAuthenticated ? '/browse' : '/register'}>
                                <Button className="bg-white text-blue-700 hover:bg-blue-50 font-bold rounded-xl shadow-md">
                                    {isAuthenticated ? t('home.browseEquipment') : t('home.registerFarmer')} →
                                </Button>
                            </Link>
                        </div>
                    </div>

                    {/* Owner CTA */}
                    <div className="relative bg-gradient-to-br from-green-800 to-green-700 rounded-3xl p-7 text-white shadow-lg overflow-hidden">
                        <div className="absolute -right-6 -bottom-6 text-[120px] opacity-10 select-none">🚜</div>
                        <div className="absolute top-4 right-4">
                            <Badge className="bg-green-600/50 text-white border-0 text-[10px]">{t('home.forOwners')}</Badge>
                        </div>
                        <div className="relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
                                <IndianRupee className="h-6 w-6 text-white" />
                            </div>
                            <h3 className="text-2xl font-black mb-2">{t('home.earnFromFleet')}</h3>
                            <p className="text-green-100 text-sm leading-relaxed mb-5">{t('home.earnDesc')}</p>
                            <Link href={isAuthenticated && user?.role === 'owner' ? '/add-equipment' : '/register'}>
                                <Button className="bg-white text-green-700 hover:bg-green-50 font-bold rounded-xl shadow-md">
                                    {isAuthenticated && user?.role === 'owner' ? t('home.listEquipment') : t('home.becomeOwner')} →
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>

                {/* ══════════════════════════════════ AI CTA STRIP ══ */}
                <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl p-6 lg:p-8 flex flex-col sm:flex-row items-center justify-between gap-5 text-white shadow-lg">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                            <Zap className="h-7 w-7 text-white" />
                        </div>
                        <div>
                            <p className="font-black text-lg">{t('home.aiTitle')}</p>
                            <p className="text-indigo-200 text-sm mt-0.5">{t('home.aiDesc')}</p>
                        </div>
                    </div>
                    <Link href="/ai-assistant" className="flex-shrink-0">
                        <Button className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl px-6">
                            {t('home.tryFree')} →
                        </Button>
                    </Link>
                </div>

                <div className="h-2" />
            </div>
            <span className="hidden" aria-hidden><Quote size={0} /></span>
        </div>
    );
}

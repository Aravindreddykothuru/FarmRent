'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EquipmentCard, { type EquipmentCardData } from '@/components/EquipmentCard';
import EmptyState from '@/components/EmptyState';
import {
    Search, MapPin, SlidersHorizontal, LayoutGrid, List,
    Map, Loader2, Navigation, X, Star, ChevronDown,
    ArrowUpDown, Zap,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

const EquipmentMap = dynamic(() => import('@/components/EquipmentMap'), {
    ssr: false,
    loading: () => <div className="h-[560px] bg-gray-100 rounded-2xl animate-pulse" />,
});

export const CATEGORY_IDS = [
    { id: '',                  labelKey: 'browse.allEquipment',      emoji: '🏷️' },
    { id: 'tractor',           labelKey: 'equipment.tractor',        emoji: '🚜' },
    { id: 'combine-harvester', labelKey: 'equipment.harvester',      emoji: '🌾' },
    { id: 'rotavator',         labelKey: 'equipment.rotavator',      emoji: '🪚' },
    { id: 'boom-sprayer',      labelKey: 'equipment.sprayer',        emoji: '🧪' },
    { id: 'seed-drill',        labelKey: 'equipment.seedDrill',      emoji: '🌱' },
    { id: 'power-tiller',      labelKey: 'equipment.tiller',         emoji: '🪚' },
    { id: 'thresher',          labelKey: 'equipment.thresher',       emoji: '🌾' },
    { id: 'water-pump',        labelKey: 'equipment.waterPump',      emoji: '💧' },
    { id: 'reaper',            labelKey: 'equipment.reaper',         emoji: '🌾' },
    { id: 'cultivator',        labelKey: 'equipment.cultivator',     emoji: '🪚' },
    { id: 'disc-plough',       labelKey: 'equipment.plough',         emoji: '🏗️' },
    { id: 'transport',         labelKey: 'equipment.transport',      emoji: '🚛' },
    { id: 'power-equipment',   labelKey: 'equipment.powerEquipment', emoji: '⚡' },
    { id: 'livestock',         labelKey: 'equipment.livestock',      emoji: '🐄' },
    { id: 'storage',           labelKey: 'equipment.storage',        emoji: '📦' },
];

// SORT_OPTIONS labels are set inside BrowseContent using t() to support i18n

const RADIUS_OPTIONS = [
    { value: '10',  label: '10 km' },
    { value: '25',  label: '25 km' },
    { value: '50',  label: '50 km' },
    { value: '100', label: '100 km' },
    { value: '200', label: '200 km' },
];

const PRICE_PRESETS = [
    { label: 'Under ₹1,000', min: '', max: '1000' },
    { label: '₹1k–₹3k',     min: '1000', max: '3000' },
    { label: '₹3k–₹5k',     min: '3000', max: '5000' },
    { label: 'Above ₹5k',   min: '5000', max: '' },
];

function SkeletonCard() {
    return (
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-100">
            <Skeleton className="h-44 w-full" />
            <div className="p-4 space-y-2.5">
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-5 w-1/3 mt-1" />
            </div>
        </div>
    );
}

function FilterSidebar({
    category, setCategory,
    minPrice, setMinPrice, maxPrice, setMaxPrice,
    minRating, setMinRating,
    radius, setRadius,
    onClear,
    activeCount,
}: {
    category: string; setCategory: (v: string) => void;
    minPrice: string; setMinPrice: (v: string) => void;
    maxPrice: string; setMaxPrice: (v: string) => void;
    minRating: string; setMinRating: (v: string) => void;
    radius: string; setRadius: (v: string) => void;
    onClear: () => void; activeCount: number;
}) {
    const { t } = useLanguage();
    return (
        <aside className="w-64 flex-shrink-0 space-y-5">
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-green-700" />
                    {t('browse.filters')}
                    {activeCount > 0 && (
                        <span className="bg-green-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{activeCount}</span>
                    )}
                </h3>
                {activeCount > 0 && (
                    <button type="button" onClick={onClear} className="text-xs text-red-500 font-semibold hover:text-red-700 flex items-center gap-1">
                        <X className="h-3 w-3" /> {t('browse.clearAll')}
                    </button>
                )}
            </div>

            {/* Category */}
            <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('browse.category')}</p>
                <div className="space-y-1">
                    {CATEGORY_IDS.map(cat => (
                        <button key={cat.id} type="button"
                            onClick={() => setCategory(cat.id)}
                            className={cn(
                                'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all',
                                category === cat.id
                                    ? 'bg-green-700 text-white font-semibold'
                                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                            )}>
                            <span className="text-base leading-none">{cat.emoji}</span>
                            {t(cat.labelKey)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Price Range */}
            <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('browse.pricePerDay')}</p>
                <div className="flex gap-2 mb-2">
                    <Input type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)}
                        className="h-9 text-sm" />
                    <Input type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
                        className="h-9 text-sm" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {PRICE_PRESETS.map(p => (
                        <button key={p.label} type="button"
                            onClick={() => { setMinPrice(p.min); setMaxPrice(p.max); }}
                            className={cn(
                                'text-[10px] px-2 py-1 rounded-full border font-semibold transition-all',
                                minPrice === p.min && maxPrice === p.max
                                    ? 'bg-green-700 text-white border-green-700'
                                    : 'border-gray-200 text-gray-500 hover:border-green-300 hover:text-green-700'
                            )}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Min Rating */}
            <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('browse.minRating')}</p>
                <div className="flex gap-2">
                    {['', '3', '4', '4.5'].map(r => (
                        <button key={r} type="button"
                            onClick={() => setMinRating(r)}
                            className={cn(
                                'flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all',
                                minRating === r
                                    ? 'bg-yellow-400 text-yellow-900 border-yellow-400'
                                    : 'border-gray-200 text-gray-500 hover:border-yellow-300'
                            )}>
                            {r ? <><Star className="h-3 w-3 fill-current" /> {r}+</> : t('browse.any')}
                        </button>
                    ))}
                </div>
            </div>

            {/* Search Radius */}
            <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t('browse.searchRadius')}</p>
                <div className="grid grid-cols-3 gap-1.5">
                    {RADIUS_OPTIONS.map(r => (
                        <button key={r.value} type="button"
                            onClick={() => setRadius(r.value)}
                            className={cn(
                                'py-1.5 rounded-xl border text-xs font-semibold transition-all',
                                radius === r.value
                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                    : 'border-gray-200 text-gray-500 hover:border-indigo-300'
                            )}>
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>
        </aside>
    );
}

function BrowseContent() {
    const searchParams = useSearchParams();
    const { isAuthenticated } = useAuth();
    const { t } = useLanguage();

    const SORT_OPTIONS = [
        { value: 'distance',   label: t('browse.sortNearest') },
        { value: 'rating',     label: t('browse.sortRating') },
        { value: 'price_asc',  label: t('browse.sortPriceLow') },
        { value: 'price_desc', label: t('browse.sortPriceHigh') },
        { value: 'newest',     label: t('browse.sortNewest') },
    ];

    const [machines, setMachines]     = useState<EquipmentCardData[]>([]);
    const [favIds, setFavIds]         = useState<string[]>([]);
    const [isLoading, setIsLoading]   = useState(true);
    const [total, setTotal]           = useState(0);
    const [view, setView]             = useState<'grid' | 'list' | 'map'>('grid');
    const [showMobileFilters, setShowMobileFilters] = useState(false);

    const [search,    setSearch]    = useState(searchParams.get('q') ?? '');
    const [category,  setCategory]  = useState(searchParams.get('category') ?? '');
    const [minPrice,  setMinPrice]  = useState('');
    const [maxPrice,  setMaxPrice]  = useState('');
    const [minRating, setMinRating] = useState('');
    const [radius,    setRadius]    = useState('50');
    const [sort,      setSort]      = useState(searchParams.get('sort') ?? 'distance');

    const { state: geoState, request: requestLocation, reset: resetLocation } = useGeolocation();
    const [manualLoc, setManualLoc] = useState(searchParams.get('loc') ?? '');

    const activeFilterCount = [category, minPrice || maxPrice, minRating, radius !== '50' ? radius : ''].filter(Boolean).length;

    const clearFilters = () => {
        setCategory(''); setMinPrice(''); setMaxPrice('');
        setMinRating(''); setRadius('50');
    };

    // Fetch favorites IDs
    useEffect(() => {
        if (!isAuthenticated) return;
        nodeApi.get<any>('/favorites/ids').then(r => setFavIds(r?.ids ?? [])).catch(() => {});
    }, [isAuthenticated]);

    // Fetch machines (debounced)
    useEffect(() => {
        let stale = false;
        const timer = setTimeout(async () => {
            setIsLoading(true);
            const params: Record<string, string> = { status: 'available', sort, limit: '48' };
            if (search)    params.q        = search;
            if (category)  params.type     = category;
            if (minPrice)  params.minPrice = minPrice;
            if (maxPrice)  params.maxPrice = maxPrice;
            if (minRating) params.minRating = minRating;
            if (radius)    params.radius   = radius;
            if (geoState.status === 'resolved') {
                params.lat = String(geoState.position.lat);
                params.lng = String(geoState.position.lng);
            } else if (/^\d{6}$/.test(manualLoc.trim())) {
                params.pincode = manualLoc.trim();
            } else if (manualLoc.trim()) {
                params.district = manualLoc.trim();
            }
            try {
                const res: any = await nodeApi.get(`/search/machines?${new URLSearchParams(params)}`);
                if (stale) return;
                const list = res?.data?.machines ?? res?.machines ?? res?.data ?? [];
                setMachines(list);
                setTotal(res?.total ?? list.length);
            } catch {
                if (!stale) { setMachines([]); setTotal(0); }
            } finally {
                if (!stale) setIsLoading(false);
            }
        }, 350);
        return () => { stale = true; clearTimeout(timer); };
    }, [search, category, minPrice, maxPrice, minRating, sort, radius, geoState, manualLoc]);

    const locValue = geoState.status === 'resolved'
        ? (geoState.position.address?.district || geoState.position.address?.village || 'Your Location')
        : manualLoc;

    return (
        <div className="flex gap-6">
            {/* ── Desktop sidebar ───────────────────────────────────────── */}
            <div className="hidden lg:block">
                <div className="sticky top-20 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <FilterSidebar
                        category={category} setCategory={setCategory}
                        minPrice={minPrice} setMinPrice={setMinPrice}
                        maxPrice={maxPrice} setMaxPrice={setMaxPrice}
                        minRating={minRating} setMinRating={setMinRating}
                        radius={radius} setRadius={setRadius}
                        onClear={clearFilters} activeCount={activeFilterCount}
                    />
                </div>
            </div>

            {/* ── Main content ──────────────────────────────────────────── */}
            <div className="flex-1 min-w-0">
                {/* Search + Location bar */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                    <div className="relative flex-1">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input placeholder={t('browse.locationPlaceholder')}
                            value={locValue}
                            onChange={e => { if (geoState.status === 'resolved') resetLocation(); setManualLoc(e.target.value); }}
                            className="pl-9 pr-10 h-11 focus-visible:ring-green-600" />
                        <button type="button" onClick={() => geoState.status === 'resolved' ? resetLocation() : requestLocation()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title={geoState.status === 'resolved' ? 'Clear location' : 'Detect location'}>
                            {geoState.status === 'requesting'
                                ? <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                                : <Navigation className={cn('h-4 w-4', geoState.status === 'resolved' ? 'text-green-600' : 'text-gray-400')} />}
                        </button>
                    </div>
                    <div className="relative flex-[1.5]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input placeholder={t('browse.searchPlaceholder')}
                            value={search} onChange={e => setSearch(e.target.value)}
                            className="pl-9 h-11 focus-visible:ring-green-600" />
                        {search && (
                            <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100">
                                <X className="h-3.5 w-3.5 text-gray-400" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-3 mb-5 flex-wrap">
                    <div className="flex items-center gap-2 text-sm text-gray-500 font-medium flex-1">
                        {isLoading ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin text-green-600" /> {t('browse.searching')}</>
                        ) : (
                            <span className="text-gray-900 font-bold">
                                {geoState.status === 'resolved'
                                    ? t('browse.resultsNear', { count: String(total), location: locValue })
                                    : t('browse.results', { count: String(total) })}
                            </span>
                        )}
                    </div>

                    {/* Mobile filter toggle */}
                    <Button variant="outline" size="sm" className="lg:hidden gap-1.5" onClick={() => setShowMobileFilters(true)}>
                        <SlidersHorizontal className="h-4 w-4" />
                        {t('browse.filters')} {activeFilterCount > 0 && <span className="bg-green-700 text-white text-[10px] rounded-full px-1.5 py-px">{activeFilterCount}</span>}
                    </Button>

                    {/* Sort */}
                    <Select value={sort} onValueChange={setSort}>
                        <SelectTrigger className="h-9 w-44 text-sm">
                            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SORT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                    </Select>

                    {/* View toggle */}
                    <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                        {([{ v: 'grid' as const, Icon: LayoutGrid, label: t('browse.gridView') }, { v: 'list' as const, Icon: List, label: t('browse.listView') }, { v: 'map' as const, Icon: Map, label: t('browse.mapView') }]).map(({ v, Icon, label }) => (
                            <button key={v} type="button" aria-label={label} onClick={() => setView(v)}
                                className={cn('px-3 py-2 transition-colors', view === v ? 'bg-green-700 text-white' : 'bg-white text-gray-400 hover:bg-gray-50')}>
                                <Icon className="h-4 w-4" />
                            </button>
                        ))}
                    </div>
                </div>

                {/* Active filter badges */}
                {activeFilterCount > 0 && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {category && <Badge variant="secondary" className="gap-1 bg-green-50 text-green-700 border border-green-200">
                            {CATEGORY_IDS.find(c => c.id === category)?.emoji} {(() => { const cat = CATEGORY_IDS.find(c => c.id === category); return cat ? t(cat.labelKey) : ''; })()}
                            <button type="button" aria-label="Remove category filter" onClick={() => setCategory('')}><X className="h-3 w-3" /></button>
                        </Badge>}
                        {(minPrice || maxPrice) && <Badge variant="secondary" className="gap-1 bg-blue-50 text-blue-700 border border-blue-200">
                            ₹{minPrice||'0'} – ₹{maxPrice||'∞'}/day
                            <button type="button" aria-label="Remove price filter" onClick={() => { setMinPrice(''); setMaxPrice(''); }}><X className="h-3 w-3" /></button>
                        </Badge>}
                        {minRating && <Badge variant="secondary" className="gap-1 bg-yellow-50 text-yellow-700 border border-yellow-200">
                            <Star className="h-3 w-3 fill-current" /> {minRating}+ stars
                            <button type="button" aria-label="Remove rating filter" onClick={() => setMinRating('')}><X className="h-3 w-3" /></button>
                        </Badge>}
                        {radius !== '50' && <Badge variant="secondary" className="gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <Zap className="h-3 w-3" /> Within {radius} km
                            <button type="button" aria-label="Remove radius filter" onClick={() => setRadius('50')}><X className="h-3 w-3" /></button>
                        </Badge>}
                    </div>
                )}

                {/* Map view */}
                {view === 'map' && (
                    <div className="relative rounded-2xl overflow-hidden">
                        {isLoading && <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-green-700" /></div>}
                        <EquipmentMap machines={machines as any} />
                    </div>
                )}

                {/* List view */}
                {view === 'list' && !isLoading && (
                    machines.length === 0 ? (
                        <EmptyState icon="🚜" title={t('browse.noEquipment')} description={t('browse.tryFilters')}
                            action={{ label: t('browse.clearFilters'), onClick: () => { clearFilters(); setSearch(''); } }} />
                    ) : (
                        <div className="space-y-3">
                            {machines.map(m => (
                                <EquipmentCard key={m._id ?? m.id} machine={m} variant="list"
                                    isFavorited={favIds.includes(m._id ?? m.id ?? '')} />
                            ))}
                        </div>
                    )
                )}

                {/* Grid view */}
                {view === 'grid' && (
                    isLoading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                            {[...Array(12)].map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : machines.length === 0 ? (
                        <EmptyState icon="🚜" title={t('browse.noEquipment')}
                            description={t('browse.tryFilters')}
                            action={{ label: t('browse.clearAllFilters'), onClick: () => { clearFilters(); setSearch(''); } }} />
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                            {machines.map(m => (
                                <EquipmentCard key={m._id ?? m.id} machine={m} variant="grid"
                                    isFavorited={favIds.includes(m._id ?? m.id ?? '')} />
                            ))}
                        </div>
                    )
                )}

                {/* Load more hint */}
                {!isLoading && machines.length > 0 && total > machines.length && (
                    <div className="mt-8 text-center">
                        <p className="text-sm text-gray-400 mb-2">{t('browse.showing', { shown: String(machines.length), total: String(total) })}</p>
                        <Button variant="outline" className="border-green-200 text-green-700 hover:bg-green-50">
                            {t('browse.loadMore')} <ChevronDown className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                )}
            </div>

            {/* ── Mobile filter drawer ──────────────────────────────────── */}
            {showMobileFilters && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileFilters(false)} />
                    <div className="absolute inset-y-0 left-0 w-80 bg-white shadow-2xl overflow-y-auto">
                        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                            <h3 className="font-bold text-gray-900">{t('browse.filters')}</h3>
                            <button type="button" aria-label="Close filters" onClick={() => setShowMobileFilters(false)} className="p-2 rounded-lg hover:bg-gray-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-5">
                            <FilterSidebar
                                category={category} setCategory={setCategory}
                                minPrice={minPrice} setMinPrice={setMinPrice}
                                maxPrice={maxPrice} setMaxPrice={setMaxPrice}
                                minRating={minRating} setMinRating={setMinRating}
                                radius={radius} setRadius={setRadius}
                                onClear={clearFilters} activeCount={activeFilterCount}
                            />
                        </div>
                        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4">
                            <Button className="w-full bg-green-700 hover:bg-green-800" onClick={() => setShowMobileFilters(false)}>
                                {t('browse.showResults')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function BrowsePage() {
    const { t } = useLanguage();
    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Page header */}
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 py-6 max-w-screen-xl">
                    <h1 className="text-2xl lg:text-3xl font-black text-gray-900 mb-0.5">{t('browse.title')}</h1>
                    <p className="text-gray-500 text-sm">{t('browse.subtitle')}</p>
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 py-6 max-w-screen-xl">
                <Suspense fallback={
                    <div className="flex items-center justify-center py-32">
                        <Loader2 className="h-10 w-10 animate-spin text-green-700" />
                    </div>
                }>
                    <BrowseContent />
                </Suspense>
            </div>
        </div>
    );
}

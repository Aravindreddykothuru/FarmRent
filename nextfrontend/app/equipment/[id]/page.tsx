'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import useEmblaCarousel from 'embla-carousel-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import FavoriteButton from '@/components/FavoriteButton';
import {
    MapPin, Star, IndianRupee, Clock, Calendar, ChevronLeft, ChevronRight,
    User, Shield, Wrench, Phone, Loader2, AlertCircle, CheckCircle2, Info,
    Share2, Tag, Zap, Users, Gauge, Leaf, MessageSquare, Award,
    ChevronDown, ChevronUp,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { getMachineId, type Machine as BaseMachine } from '@/lib/getMachineId';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';

const EquipmentLocationMap = dynamic(() => import('@/components/EquipmentLocationMap'), {
    ssr: false,
    loading: () => <div className="h-64 rounded-2xl bg-gray-100 animate-pulse" />,
});

const EquipmentChatDrawer = dynamic(() => import('@/components/EquipmentChatDrawer'), {
    ssr: false,
});

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=800&q=80';

interface Machine extends BaseMachine {
    type: string;
    description?: string;
    status: string;
    images?: string[];
    location?: { village?: string; town?: string; district?: string; state?: string };
    pricing?: {
        baseRatePerDay?: number;
        baseRatePerHour?: number;
        securityDeposit?: number;
        operatorIncluded?: boolean;
        weeklyDiscount?: number;
    };
    specifications?: Record<string, string | number>;
    features?: string[];
    ratings?: { average?: number; count?: number };
    owner?: { name?: string; phone?: string; avatar?: string; totalRentals?: number; memberSince?: string };
    horsepower?: number;
    brand?: string;
    year?: number;
    fuelType?: string;
    inspectionDate?: string;
    inspectionPassed?: boolean;
    operatorName?: string;
}

interface Review {
    id: string;
    rating: number;
    comment?: string;
    date: string;
    user?: string;
}

function StarRow({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' }) {
    const cls = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} className={cn(cls, n <= Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200')} />
            ))}
        </div>
    );
}

function safeDate(s: string) {
    try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return ''; }
}

function daysBetween(start: string, end: string): number {
    if (!start || !end) return 0;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return Math.max(1, Math.ceil(diff / 86400000));
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}
function tomorrowStr() {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
}

export default function EquipmentDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { isAuthenticated } = useAuth();
    const { t } = useLanguage();

    const [machine, setMachine] = useState<Machine | null>(null);
    const [reviews, setReviews] = useState<Review[]>([]);
    const [bookedRanges, setBookedRanges] = useState<{ start: string; end: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [isFavorited, setIsFavorited] = useState(false);

    // Gallery
    const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
    const [activeImg, setActiveImg] = useState(0);

    // Booking widget state
    const [startDate, setStartDate] = useState(todayStr());
    const [endDate, setEndDate] = useState(tomorrowStr());

    // Chat drawer state
    const [showChat, setShowChat] = useState(false);

    // Offer state
    const [showOffer, setShowOffer] = useState(false);
    const [offerPrice, setOfferPrice] = useState('');
    const [offerMsg, setOfferMsg] = useState('');
    const [offerLoading, setOfferLoading] = useState(false);

    // Reviews collapse
    const [showAllReviews, setShowAllReviews] = useState(false);

    const scrollTo = useCallback((idx: number) => {
        emblaApi?.scrollTo(idx);
        setActiveImg(idx);
    }, [emblaApi]);

    useEffect(() => {
        emblaApi?.on('select', () => setActiveImg(emblaApi.selectedScrollSnap()));
    }, [emblaApi]);

    useEffect(() => {
        if (!id) return;
        Promise.all([
            nodeApi.get<any>(`/machines/${id}`),
            nodeApi.get<any>(`/reviews/machine/${id}`).catch(() => ({ reviews: [] })),
            nodeApi.get<any>(`/bookings/availability/${id}`).catch(() => ({ data: [] })),
            isAuthenticated ? nodeApi.get<any>('/favorites/ids').catch(() => ({ ids: [] })) : Promise.resolve({ ids: [] }),
        ]).then(([mRes, rRes, aRes, favRes]) => {
            const m = mRes?.data || mRes?.machine || mRes;
            setMachine(m);
            if (m?.pricing?.baseRatePerDay) {
                setOfferPrice(String(Math.round(m.pricing.baseRatePerDay * 0.9)));
            }
            const raw = rRes?.reviews ?? rRes?.data ?? [];
            setReviews(Array.isArray(raw) ? raw.map((r: any) => ({
                id: r.id ?? r._id ?? `${r.user}-${r.date}`,
                rating: r.rating,
                comment: r.comment ?? r.reviewText,
                date: r.date ?? r.createdAt ?? '',
                user: r.user ?? r.reviewerId?.name,
            })) : []);
            setBookedRanges(Array.isArray(aRes?.data) ? aRes.data : []);
            const mId = getMachineId(m);
            if (mId) setIsFavorited((favRes?.ids ?? []).includes(mId));
        }).catch(() => toast.error('Could not load equipment details'))
            .finally(() => setLoading(false));
    }, [id, isAuthenticated]);

    const handleMakeOffer = async () => {
        if (!isAuthenticated) { router.push('/login'); return; }
        if (!offerPrice || !startDate || !endDate) { toast.error('Fill all offer fields'); return; }
        setOfferLoading(true);
        try {
            await nodeApi.post('/offers', {
                equipment_id: machineId,
                offered_price_per_day: Number(offerPrice),
                start_date: startDate,
                end_date: endDate,
                message: offerMsg,
            });
            toast.success('Offer sent to owner!');
            setShowOffer(false);
        } catch {
            toast.error('Could not send offer');
        } finally {
            setOfferLoading(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-[#F7F8FA]">
            <div className="bg-white border-b px-4 py-3">
                <Skeleton className="h-5 w-32" />
            </div>
            <div className="container mx-auto px-4 lg:px-8 py-8 max-w-screen-xl">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-4">
                        <Skeleton className="h-96 w-full rounded-2xl" />
                        <Skeleton className="h-48 w-full rounded-2xl" />
                        <Skeleton className="h-32 w-full rounded-2xl" />
                    </div>
                    <div><Skeleton className="h-80 w-full rounded-2xl" /></div>
                </div>
            </div>
        </div>
    );

    if (!machine) return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#F7F8FA]">
            <AlertCircle className="h-16 w-16 text-red-400" />
            <h2 className="text-2xl font-bold text-gray-700">{t('equipment.notFound')}</h2>
            <p className="text-gray-400">{t('equipment.notFoundDesc')}</p>
            <Link href="/browse"><Button className="bg-green-700 hover:bg-green-800">{t('dashboard.browseEquipment')}</Button></Link>
        </div>
    );

    const machineId = getMachineId(machine);
    const images = machine.images?.filter(Boolean).length ? machine.images! : [FALLBACK];
    const isAvailable = !machine.status || machine.status === 'available';
    const avgRating = machine.ratings?.average ?? 0;
    const reviewCount = machine.ratings?.count ?? reviews.length;
    const locStr = [machine.location?.village || machine.location?.town, machine.location?.district, machine.location?.state].filter(Boolean).join(', ') || '—';
    const pricePerDay = machine.pricing?.baseRatePerDay ?? 0;
    const numDays = daysBetween(startDate, endDate);
    const subtotal = pricePerDay * numDays;
    const deposit = machine.pricing?.securityDeposit ?? 0;
    const weeklyDiscount = machine.pricing?.weeklyDiscount ?? 0;
    const discountAmt = numDays >= 7 && weeklyDiscount > 0 ? Math.round(subtotal * weeklyDiscount / 100) : 0;
    const totalAmt = subtotal - discountAmt + deposit;

    const visibleReviews = showAllReviews ? reviews : reviews.slice(0, 3);

    return (
        <div className="min-h-screen bg-[#F7F8FA] pb-28 lg:pb-12">
            {/* Breadcrumb */}
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 py-3 max-w-screen-xl flex items-center justify-between">
                    <Link href="/browse" className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 font-medium">
                        <ChevronLeft className="h-4 w-4" /> {t('dashboard.browseEquipment')}
                    </Link>
                    <div className="flex items-center gap-2">
                        {machineId && <FavoriteButton equipmentId={machineId} initialFavorited={isFavorited} size="md" />}
                        <button type="button" aria-label="Share" onClick={() => {
                            navigator.share?.({ title: machine.name, url: window.location.href })
                                .catch(() => { navigator.clipboard.writeText(window.location.href); toast.success('Link copied!'); });
                        }} className="h-9 w-9 flex items-center justify-center rounded-full border border-gray-200 bg-white hover:bg-gray-50 transition-colors">
                            <Share2 className="h-4 w-4 text-gray-500" />
                        </button>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 py-6 max-w-screen-xl">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">

                    {/* ── Left column ─────────────────────────────────────── */}
                    <div className="lg:col-span-2 space-y-5">

                        {/* Gallery */}
                        <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                            <div className="relative overflow-hidden" ref={emblaRef}>
                                <div className="flex">
                                    {images.map((img, i) => (
                                        <div key={i} className="relative flex-none w-full h-80 lg:h-[440px] bg-gray-100">
                                            <img src={img} alt={`${machine.name} ${i + 1}`}
                                                className="w-full h-full object-cover"
                                                onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                        </div>
                                    ))}
                                </div>

                                {/* Overlay controls */}
                                <div className="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-none">
                                    <Badge className="bg-white/95 text-gray-700 border-0 text-xs font-semibold capitalize shadow-sm pointer-events-auto">
                                        {machine.type?.replace(/-/g, ' ') || 'Equipment'}
                                    </Badge>
                                    {!isAvailable && (
                                        <Badge variant="destructive" className="pointer-events-auto">{t('equipment.unavailable')}</Badge>
                                    )}
                                </div>

                                {images.length > 1 && (
                                    <>
                                        <button type="button" aria-label="Previous image"
                                            onClick={() => emblaApi?.scrollPrev()}
                                            className="absolute left-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white h-9 w-9 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm">
                                            <ChevronLeft className="h-5 w-5" />
                                        </button>
                                        <button type="button" aria-label="Next image"
                                            onClick={() => emblaApi?.scrollNext()}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 bg-black/40 hover:bg-black/60 text-white h-9 w-9 rounded-full flex items-center justify-center transition-colors backdrop-blur-sm">
                                            <ChevronRight className="h-5 w-5" />
                                        </button>
                                        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
                                            {images.map((_, i) => (
                                                <button key={i} type="button" aria-label={`Go to image ${i + 1}`}
                                                    onClick={() => scrollTo(i)}
                                                    className={cn('rounded-full transition-all', i === activeImg ? 'bg-white w-5 h-2' : 'bg-white/50 w-2 h-2')} />
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>

                            {/* Thumbnail strip */}
                            {images.length > 1 && (
                                <div className="flex gap-2 p-3 overflow-x-auto">
                                    {images.map((img, i) => (
                                        <button key={i} type="button" aria-label={`View image ${i + 1}`}
                                            onClick={() => scrollTo(i)}
                                            className={cn('h-16 w-20 rounded-xl overflow-hidden flex-shrink-0 border-2 transition-all',
                                                i === activeImg ? 'border-green-600 opacity-100' : 'border-transparent opacity-60 hover:opacity-90')}>
                                            <img src={img} alt="" className="w-full h-full object-cover"
                                                onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Name + Status + Rating */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                                <div className="flex-1 min-w-0">
                                    <h1 className="text-2xl lg:text-3xl font-black text-gray-900 leading-tight">{machine.name}</h1>
                                    <div className="flex items-center gap-1.5 mt-2 text-gray-500 text-sm">
                                        <MapPin className="h-4 w-4 text-green-600 flex-shrink-0" />
                                        <span>{locStr}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <Badge className={cn('px-3 py-1 text-xs font-semibold border-0',
                                        isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                                        {isAvailable ? `✓ ${t('equipment.available')}` : `✗ ${t('equipment.unavailable')}`}
                                    </Badge>
                                    {avgRating > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <StarRow rating={avgRating} />
                                            <span className="text-sm font-bold text-gray-800">{avgRating.toFixed(1)}</span>
                                            <span className="text-xs text-gray-400">({reviewCount})</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {machine.description && (
                                <p className="text-gray-600 text-sm leading-relaxed">{machine.description}</p>
                            )}

                            {machine.features && machine.features.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-4">
                                    {machine.features.map(f => (
                                        <span key={f} className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-full font-medium">
                                            <CheckCircle2 className="h-3 w-3" /> {f}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Quick specs pills */}
                        {(machine.horsepower || machine.brand || machine.year || machine.fuelType) && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {machine.horsepower && (
                                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col items-center gap-1">
                                        <Gauge className="h-5 w-5 text-green-600" />
                                        <span className="text-lg font-black text-gray-900">{machine.horsepower}</span>
                                        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{t('equipment.horsepower')}</span>
                                    </div>
                                )}
                                {machine.brand && (
                                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col items-center gap-1">
                                        <Award className="h-5 w-5 text-indigo-600" />
                                        <span className="text-sm font-black text-gray-900">{machine.brand}</span>
                                        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{t('equipment.brand')}</span>
                                    </div>
                                )}
                                {machine.year && (
                                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col items-center gap-1">
                                        <Calendar className="h-5 w-5 text-amber-600" />
                                        <span className="text-lg font-black text-gray-900">{machine.year}</span>
                                        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{t('equipment.year')}</span>
                                    </div>
                                )}
                                {machine.fuelType && (
                                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-col items-center gap-1">
                                        <Leaf className="h-5 w-5 text-emerald-600" />
                                        <span className="text-sm font-black text-gray-900 capitalize">{machine.fuelType}</span>
                                        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{t('equipment.fuel')}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Full specifications table */}
                        {machine.specifications && Object.keys(machine.specifications).length > 0 && (
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                    <Wrench className="h-5 w-5 text-green-600" /> {t('equipment.specifications')}
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y divide-gray-50">
                                    {Object.entries(machine.specifications).map(([k, v]) => (
                                        <div key={k} className="flex items-center justify-between py-3 px-1">
                                            <span className="text-sm text-gray-500 capitalize">{k.replace(/_/g, ' ')}</span>
                                            <span className="text-sm font-semibold text-gray-900">{String(v)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Inspection & Verification */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <Shield className="h-5 w-5 text-green-600" /> {t('equipment.inspectionSafety')}
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className={cn('flex items-center gap-3 p-3 rounded-xl border',
                                    machine.inspectionPassed !== false ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50')}>
                                    <CheckCircle2 className={cn('h-6 w-6 flex-shrink-0', machine.inspectionPassed !== false ? 'text-green-600' : 'text-gray-300')} />
                                    <div>
                                        <p className="text-xs font-bold text-gray-700">{t('equipment.safetyCheck')}</p>
                                        <p className="text-[11px] text-gray-500">
                                            {machine.inspectionDate ? `Passed ${safeDate(machine.inspectionDate)}` : 'Verified by FarmRent'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-xl border border-indigo-200 bg-indigo-50">
                                    <Shield className="h-6 w-6 flex-shrink-0 text-indigo-600" />
                                    <div>
                                        <p className="text-xs font-bold text-gray-700">{t('equipment.insurance')}</p>
                                        <p className="text-[11px] text-gray-500">3rd party covered</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50">
                                    <Users className="h-6 w-6 flex-shrink-0 text-amber-600" />
                                    <div>
                                        <p className="text-xs font-bold text-gray-700">{t('equipment.operator')}</p>
                                        <p className="text-[11px] text-gray-500">
                                            {machine.pricing?.operatorIncluded
                                                ? `${machine.operatorName || 'Operator'} included`
                                                : 'Self-operated or hire separately'}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Availability */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-green-600" /> {t('equipment.availabilityLabel')}
                            </h2>
                            {bookedRanges.length === 0 ? (
                                <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-xl px-4 py-3">
                                    <CheckCircle2 className="h-5 w-5" />
                                    <span className="text-sm font-semibold">{t('equipment.allDatesAvailable')}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2 text-amber-700 bg-amber-50 rounded-xl px-4 py-2 mb-3">
                                        <Info className="h-4 w-4 flex-shrink-0" />
                                        <span className="text-xs font-medium">{t('equipment.alreadyBooked')}</span>
                                    </div>
                                    <ul className="space-y-2">
                                        {bookedRanges.slice(0, 8).map((r, i) => (
                                            <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                                                <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                                                {safeDate(r.start)} → {safeDate(r.end)}
                                            </li>
                                        ))}
                                    </ul>
                                    {bookedRanges.length > 8 && (
                                        <p className="text-xs text-gray-400 mt-2">+{bookedRanges.length - 8} more booked periods</p>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Equipment Location Map */}
                        {(machine.location as any)?.latitude && (machine.location as any)?.longitude && (
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                                <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                                    <MapPin className="h-5 w-5 text-green-600" /> {t('equipment.equipmentLocation')}
                                </h2>
                                <EquipmentLocationMap
                                    lat={(machine.location as any).latitude}
                                    lng={(machine.location as any).longitude}
                                    name={machine.name}
                                    className="h-64 rounded-xl overflow-hidden"
                                />
                                <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                                    <MapPin className="h-3 w-3" />{locStr}
                                </p>
                            </div>
                        )}

                        {/* Reviews */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                    <Star className="h-5 w-5 text-yellow-500 fill-yellow-400" />
                                    {t('equipment.reviews')} {reviewCount > 0 && <span className="text-sm font-normal text-gray-400">({reviewCount})</span>}
                                </h2>
                                {avgRating > 0 && (
                                    <div className="text-right">
                                        <div className="text-3xl font-black text-gray-900">{avgRating.toFixed(1)}</div>
                                        <StarRow rating={avgRating} size="sm" />
                                    </div>
                                )}
                            </div>

                            {reviews.length === 0 ? (
                                <div className="text-center py-8">
                                    <MessageSquare className="h-10 w-10 text-gray-200 mx-auto mb-2" />
                                    <p className="text-sm text-gray-400">{t('equipment.noReviews')}</p>
                                </div>
                            ) : (
                                <>
                                    <div className="space-y-5">
                                        {visibleReviews.map(r => (
                                            <div key={r.id} className="flex gap-3">
                                                <div className="bg-gradient-to-br from-green-100 to-emerald-200 rounded-full h-9 w-9 flex-shrink-0 flex items-center justify-center">
                                                    <User className="h-4 w-4 text-green-700" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                        <span className="font-semibold text-sm text-gray-800">{r.user || 'Farmer'}</span>
                                                        <div className="flex items-center gap-1">
                                                            <StarRow rating={r.rating} size="sm" />
                                                            <span className="text-[11px] text-gray-400">{safeDate(r.date)}</span>
                                                        </div>
                                                    </div>
                                                    {r.comment && <p className="text-sm text-gray-600 leading-relaxed">{r.comment}</p>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {reviews.length > 3 && (
                                        <button type="button" onClick={() => setShowAllReviews(!showAllReviews)}
                                            className="mt-4 flex items-center gap-1 text-sm text-green-700 font-semibold hover:text-green-800">
                                            {showAllReviews
                                                ? <><ChevronUp className="h-4 w-4" /> {t('equipment.showLess')}</>
                                                : <><ChevronDown className="h-4 w-4" /> {t('equipment.showAllReviews', { count: String(reviews.length) })}</>}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* ── Right column — Booking sidebar ─────────────────── */}
                    <div className="space-y-4">
                        <div className="sticky top-20">

                            {/* Booking card */}
                            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
                                {/* Price header */}
                                <div className="bg-gradient-to-br from-green-700 to-green-800 px-5 py-4">
                                    <div className="flex items-baseline gap-1 text-white">
                                        <IndianRupee className="h-5 w-5 mt-0.5" />
                                        <span className="text-3xl font-black">{pricePerDay.toLocaleString('en-IN')}</span>
                                        <span className="text-green-200 text-sm font-normal ml-1">{t('equipment.perDay')}</span>
                                    </div>
                                    {machine.pricing?.baseRatePerHour && (
                                        <div className="flex items-center gap-1 text-green-200 text-sm mt-1">
                                            <Clock className="h-3.5 w-3.5" />
                                            ₹{machine.pricing.baseRatePerHour.toLocaleString('en-IN')}/hour also available
                                        </div>
                                    )}
                                    {avgRating > 0 && (
                                        <div className="flex items-center gap-1 mt-2">
                                            <Star className="h-3.5 w-3.5 text-yellow-300 fill-yellow-300" />
                                            <span className="text-white text-sm font-semibold">{avgRating.toFixed(1)}</span>
                                            <span className="text-green-200 text-xs">· {reviewCount} reviews</span>
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 space-y-4">
                                    {/* Date range */}
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label htmlFor="booking-start" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">{t('equipment.from')}</label>
                                            <input id="booking-start" type="date" value={startDate} min={todayStr()}
                                                suppressHydrationWarning
                                                title="Rental start date" aria-label="Rental start date"
                                                onChange={e => { setStartDate(e.target.value); if (e.target.value >= endDate) { const d = new Date(e.target.value); d.setDate(d.getDate() + 1); setEndDate(d.toISOString().split('T')[0]); } }}
                                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                                        </div>
                                        <div>
                                            <label htmlFor="booking-end" className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">{t('equipment.to')}</label>
                                            <input id="booking-end" type="date" value={endDate} min={startDate || todayStr()}
                                                suppressHydrationWarning
                                                title="Rental end date" aria-label="Rental end date"
                                                onChange={e => setEndDate(e.target.value)}
                                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent" />
                                        </div>
                                    </div>

                                    {/* Price breakdown */}
                                    {numDays > 0 && pricePerDay > 0 && (
                                        <div className="bg-gray-50 rounded-xl p-3 space-y-2 text-sm">
                                            <div className="flex justify-between text-gray-600">
                                                <span>₹{pricePerDay.toLocaleString('en-IN')} × {numDays} day{numDays > 1 ? 's' : ''}</span>
                                                <span className="font-semibold">₹{subtotal.toLocaleString('en-IN')}</span>
                                            </div>
                                            {discountAmt > 0 && (
                                                <div className="flex justify-between text-green-600">
                                                    <span>Weekly discount ({weeklyDiscount}%)</span>
                                                    <span className="font-semibold">-₹{discountAmt.toLocaleString('en-IN')}</span>
                                                </div>
                                            )}
                                            {deposit > 0 && (
                                                <div className="flex justify-between text-gray-600">
                                                    <span>{t('equipment.deposit')} <span className="text-gray-400 text-xs">{t('equipment.refundable')}</span></span>
                                                    <span className="font-semibold">₹{deposit.toLocaleString('en-IN')}</span>
                                                </div>
                                            )}
                                            <div className="border-t border-gray-200 pt-2 flex justify-between font-bold text-gray-900">
                                                <span>{t('equipment.total')}</span>
                                                <span className="text-green-700">₹{totalAmt.toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Operator info */}
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <Users className="h-3.5 w-3.5 flex-shrink-0" />
                                        {machine.pricing?.operatorIncluded
                                            ? <span className="text-green-700 font-semibold">{t('equipment.operatorIncludedNote')}</span>
                                            : <span>{t('equipment.operatorNotIncluded')}</span>}
                                    </div>

                                    {/* Book Now CTA */}
                                    <Button
                                        className="w-full bg-green-700 hover:bg-green-800 text-white rounded-xl h-12 text-base font-bold shadow-md"
                                        disabled={!isAvailable || !machineId}
                                        onClick={() => machineId && router.push(`/book/${machineId}?startDate=${startDate}&endDate=${endDate}`)}>
                                        <Calendar className="mr-2 h-5 w-5" />
                                        {isAvailable ? t('equipment.bookNow') : t('equipment.unavailable')}
                                    </Button>

                                    {/* Make an Offer */}
                                    {isAvailable && pricePerDay > 0 && (
                                        <button type="button" onClick={() => setShowOffer(!showOffer)}
                                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-green-300 text-green-700 text-sm font-semibold hover:bg-green-50 transition-colors">
                                            <Tag className="h-4 w-4" />
                                            {t('equipment.makeOffer')}
                                        </button>
                                    )}

                                    {/* Offer panel */}
                                    {showOffer && (
                                        <div className="border border-green-200 rounded-xl p-3 space-y-3 bg-green-50/50">
                                            <p className="text-xs font-bold text-gray-700">Suggest a price to the owner</p>
                                            <div className="relative">
                                                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                                                <input type="number" value={offerPrice} onChange={e => setOfferPrice(e.target.value)}
                                                    placeholder="Your price per day"
                                                    suppressHydrationWarning
                                                    aria-label="Offer price per day"
                                                    className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white" />
                                            </div>
                                            <textarea value={offerMsg} onChange={e => setOfferMsg(e.target.value)}
                                                placeholder="Message to owner (optional)…"
                                                suppressHydrationWarning
                                                aria-label="Message to owner"
                                                rows={2}
                                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-500 bg-white" />
                                            <div className="flex gap-2">
                                                <Button type="button" size="sm"
                                                    className="flex-1 bg-green-700 hover:bg-green-800 text-white"
                                                    disabled={offerLoading} onClick={handleMakeOffer}>
                                                    {offerLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('equipment.sendOffer')}
                                                </Button>
                                                <Button type="button" variant="ghost" size="sm"
                                                    onClick={() => setShowOffer(false)} className="text-gray-500">
                                                    {t('common.cancel')}
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    <p className="text-xs text-center text-gray-400 flex items-center justify-center gap-1">
                                        <Shield className="h-3 w-3" /> {t('equipment.securePaymentNote')}
                                    </p>
                                </div>
                            </div>

                            {/* Owner card — prominent with chat */}
                            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 mt-4">
                                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                                    <User className="h-4 w-4 text-green-600" /> {t('equipment.owner')}
                                </h3>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="bg-gradient-to-br from-green-100 to-emerald-200 rounded-full h-14 w-14 flex-shrink-0 flex items-center justify-center text-green-700 font-bold text-xl overflow-hidden">
                                        {machine.owner?.avatar
                                            ? <img src={machine.owner.avatar} alt={machine.owner.name} className="w-full h-full object-cover" />
                                            : machine.owner?.name?.[0]?.toUpperCase() || 'O'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-gray-900 text-base">{machine.owner?.name || 'Equipment Owner'}</p>
                                        {machine.owner?.memberSince && (
                                            <p className="text-xs text-gray-400">Member since {safeDate(machine.owner.memberSince)}</p>
                                        )}
                                        <div className="flex items-center gap-3 mt-1">
                                            {machine.owner?.totalRentals !== undefined && (
                                                <span className="text-xs text-gray-500 font-medium">{machine.owner.totalRentals}+ rentals</span>
                                            )}
                                            {avgRating > 0 && (
                                                <span className="flex items-center gap-0.5 text-xs text-yellow-600 font-medium">
                                                    <Star className="h-3 w-3 fill-current" /> {avgRating.toFixed(1)}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {machine.owner?.phone && (
                                    <a href={`tel:${machine.owner.phone}`}
                                        className="flex items-center gap-2 text-sm text-green-700 font-semibold bg-green-50 rounded-xl px-3 py-2.5 mb-3 hover:bg-green-100 transition-colors">
                                        <Phone className="h-4 w-4 flex-shrink-0" />
                                        <span>{machine.owner.phone}</span>
                                    </a>
                                )}

                                {/* Chat with Owner CTA */}
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full border-2 border-green-200 text-green-700 hover:bg-green-50 hover:border-green-400 rounded-xl font-bold gap-2"
                                    onClick={() => {
                                        if (!isAuthenticated) { router.push('/login'); return; }
                                        setShowChat(true);
                                    }}
                                >
                                    <MessageSquare className="h-4 w-4" />
                                    {t('equipment.chatWithOwner')}
                                </Button>
                            </div>

                            {/* Trust badges */}
                            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mt-4 space-y-2.5">
                                {[
                                    { icon: Shield,       text: t('equipment.verifiedListing') },
                                    { icon: CheckCircle2, text: t('equipment.qualityAssured') },
                                    { icon: Zap,          text: t('equipment.instantConfirmation') },
                                ].map(({ icon: Icon, text }) => (
                                    <div key={text} className="flex items-center gap-2.5 text-xs text-gray-600">
                                        <Icon className="h-4 w-4 text-green-600 flex-shrink-0" />
                                        {text}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── OLX-style Chat Drawer ─────────────────────────────────── */}
            {showChat && machine && (
                <EquipmentChatDrawer
                    equipmentId={machineId ?? id}
                    equipmentName={machine.name}
                    equipmentImage={images[0]}
                    owner={{
                        id: (machine as any).owner_id ?? (machine.owner as any)?.id,
                        name: machine.owner?.name,
                        phone: machine.owner?.phone,
                        avatar: machine.owner?.avatar,
                        memberSince: machine.owner?.memberSince,
                        totalRentals: machine.owner?.totalRentals,
                    }}
                    onClose={() => setShowChat(false)}
                />
            )}

            {/* ── Mobile sticky bottom bar ──────────────────────────────── */}
            <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-2xl px-4 py-3 safe-area-inset-bottom">
                <div className="flex items-center gap-3 max-w-lg mx-auto">
                    <div className="flex-1">
                        <div className="flex items-baseline gap-0.5 text-green-700">
                            <IndianRupee className="h-4 w-4 mt-0.5" />
                            <span className="text-xl font-black">{pricePerDay.toLocaleString('en-IN')}</span>
                            <span className="text-gray-400 font-normal text-sm ml-0.5">{t('equipment.perDay')}</span>
                        </div>
                        {numDays > 1 && pricePerDay > 0 && (
                            <p className="text-xs text-gray-500">{numDays} days · ₹{subtotal.toLocaleString('en-IN')} total</p>
                        )}
                    </div>
                    <Button
                        className="bg-green-700 hover:bg-green-800 text-white rounded-2xl px-8 h-12 text-base font-bold shadow-lg"
                        disabled={!isAvailable || !machineId}
                        onClick={() => machineId && router.push(`/book/${machineId}?startDate=${startDate}&endDate=${endDate}`)}>
                        {isAvailable ? t('equipment.bookNow') : t('equipment.unavailable')}
                    </Button>
                </div>
            </div>
        </div>
    );
}

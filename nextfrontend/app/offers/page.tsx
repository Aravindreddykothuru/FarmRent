'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Tag, CheckCircle2, XCircle, Clock, IndianRupee, Calendar, ChevronLeft,
    MessageSquare, ArrowRight, TrendingDown, RefreshCw,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

interface Offer {
    id: string;
    equipment_id: string;
    equipment_name?: string;
    equipment_image?: string;
    offered_price_per_day: number;
    counter_price?: number;
    start_date: string;
    end_date: string;
    status: 'pending' | 'accepted' | 'rejected' | 'countered' | 'expired';
    message?: string;
    owner_message?: string;
    renter_name?: string;
    created_at: string;
}

const STATUS_COLORS: Record<string, { color: string; icon: React.ElementType }> = {
    pending:   { color: 'bg-amber-100 text-amber-700 border-amber-200',    icon: Clock },
    accepted:  { color: 'bg-green-100 text-green-700 border-green-200',    icon: CheckCircle2 },
    rejected:  { color: 'bg-red-100 text-red-700 border-red-200',          icon: XCircle },
    countered: { color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: RefreshCw },
    expired:   { color: 'bg-gray-100 text-gray-500 border-gray-200',       icon: Clock },
};

function safeDate(s: string) {
    try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return s; }
}

function OfferCard({
    offer, mode, onRespond,
}: {
    offer: Offer;
    mode: 'sent' | 'received';
    onRespond?: (id: string, action: 'accept' | 'reject' | 'counter', counterPrice?: number) => void;
}) {
    const { t } = useLanguage();
    const statusColors = STATUS_COLORS[offer.status] ?? STATUS_COLORS.pending;
    const Icon = statusColors.icon;
    const statusLabel = t(`offers.${offer.status}` as any) || offer.status;
    const [counterInput, setCounterInput] = useState('');
    const [showCounter, setShowCounter] = useState(false);

    const days = Math.max(1, Math.ceil((new Date(offer.end_date).getTime() - new Date(offer.start_date).getTime()) / 86400000));
    const totalOffered = offer.offered_price_per_day * days;

    const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200&q=60';

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
            <div className="flex gap-0">
                {/* Equipment image strip */}
                <div className="w-28 flex-shrink-0 relative overflow-hidden bg-gray-100">
                    <img src={offer.equipment_image || FALLBACK} alt={offer.equipment_name || 'Equipment'}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent to-white/10" />
                </div>

                <div className="flex-1 p-4 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                            <Link href={`/equipment/${offer.equipment_id}`}
                                className="font-bold text-gray-900 text-sm leading-tight hover:text-green-700 line-clamp-1 block">
                                {offer.equipment_name || 'Equipment'}
                            </Link>
                            {mode === 'received' && offer.renter_name && (
                                <p className="text-xs text-gray-500 mt-0.5">{t('offers.from')} {offer.renter_name}</p>
                            )}
                        </div>
                        <Badge className={cn('text-[10px] font-bold border flex items-center gap-1 flex-shrink-0', statusColors.color)}>
                            <Icon className="h-3 w-3" /> {statusLabel}
                        </Badge>
                    </div>

                    {/* Price comparison */}
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className="flex items-center gap-0.5 text-green-700">
                            <TrendingDown className="h-3.5 w-3.5" />
                            <IndianRupee className="h-3 w-3" />
                            <span className="text-base font-black">{offer.offered_price_per_day.toLocaleString('en-IN')}</span>
                            <span className="text-xs text-gray-400 ml-0.5">{t('equipment.perDay')}</span>
                        </div>
                        {offer.counter_price && (
                            <div className="flex items-center gap-1 text-indigo-600 text-sm">
                                <ArrowRight className="h-3 w-3" />
                                <span className="font-bold">{t('offers.counterLabel')} ₹{offer.counter_price.toLocaleString('en-IN')}{t('equipment.perDay')}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-gray-500 mb-3 flex-wrap">
                        <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3 text-green-600" />
                            {safeDate(offer.start_date)} → {safeDate(offer.end_date)}
                        </span>
                        <span className="font-semibold text-gray-700">
                            {days}d · ₹{totalOffered.toLocaleString('en-IN')} total
                        </span>
                    </div>

                    {offer.message && (
                        <div className="flex items-start gap-1.5 text-xs text-gray-500 mb-3 bg-gray-50 rounded-lg px-3 py-2">
                            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-gray-400" />
                            <span className="italic">{offer.message}</span>
                        </div>
                    )}

                    {offer.owner_message && offer.status !== 'pending' && (
                        <div className="flex items-start gap-1.5 text-xs text-indigo-600 mb-3 bg-indigo-50 rounded-lg px-3 py-2">
                            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                            <span className="italic">{offer.owner_message}</span>
                        </div>
                    )}

                    {/* Owner action buttons */}
                    {mode === 'received' && offer.status === 'pending' && onRespond && (
                        <div className="space-y-2">
                            {!showCounter ? (
                                <div className="flex gap-2">
                                    <Button size="sm" className="bg-green-700 hover:bg-green-800 text-white flex-1"
                                        onClick={() => onRespond(offer.id, 'accept')}>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t('booking.accept')}
                                    </Button>
                                    <Button size="sm" variant="outline"
                                        className="border-indigo-200 text-indigo-600 hover:bg-indigo-50 flex-1"
                                        onClick={() => setShowCounter(true)}>
                                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> {t('offers.counter')}
                                    </Button>
                                    <Button size="sm" variant="outline"
                                        className="border-red-200 text-red-500 hover:bg-red-50 flex-1"
                                        onClick={() => onRespond(offer.id, 'reject')}>
                                        <XCircle className="h-3.5 w-3.5 mr-1" /> {t('dashboard.reject')}
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex gap-2 items-center">
                                    <div className="relative flex-1">
                                        <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                                        <input type="number" value={counterInput} onChange={e => setCounterInput(e.target.value)}
                                            placeholder={t('offers.counterPlaceholder')} aria-label="Counter price per day"
                                            className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white"
                                        onClick={() => { if (counterInput) { onRespond(offer.id, 'counter', Number(counterInput)); setShowCounter(false); } }}>
                                        {t('offers.send')}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setShowCounter(false)}>{t('common.cancel')}</Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Renter: book at counter price */}
                    {mode === 'sent' && offer.status === 'countered' && offer.counter_price && (
                        <div className="flex gap-2">
                            <Link href={`/book/${offer.equipment_id}?startDate=${offer.start_date}&endDate=${offer.end_date}`} className="flex-1">
                                <Button size="sm" className="w-full bg-green-700 hover:bg-green-800 text-white">
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {t('offers.acceptBook', { price: offer.counter_price?.toLocaleString('en-IN') ?? '' })}
                                </Button>
                            </Link>
                        </div>
                    )}

                    <p className="text-[10px] text-gray-400 mt-2">{t('offers.sentOn', { date: safeDate(offer.created_at) })}</p>
                </div>
            </div>
        </div>
    );
}

function SkeletonOffer() {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <div className="flex">
                <Skeleton className="w-28 h-36" />
                <div className="flex-1 p-4 space-y-3">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-8 w-full" />
                </div>
            </div>
        </div>
    );
}

export default function OffersPage() {
    const { isAuthenticated, isLoading: authLoading, user } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const [sentOffers, setSentOffers]     = useState<Offer[]>([]);
    const [recvOffers, setRecvOffers]     = useState<Offer[]>([]);
    const [loading, setLoading]           = useState(true);
    const [respondingId, setRespondingId] = useState<string | null>(null);
    const [tab, setTab]                   = useState<'sent' | 'received'>('sent');

    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) { router.replace('/login?next=/offers'); return; }
        Promise.all([
            nodeApi.get<any>('/offers/my').catch(() => []),
            user?.role === 'owner' ? nodeApi.get<any>('/offers/received').catch(() => []) : Promise.resolve([]),
        ]).then(([myRes, recvRes]) => {
            setSentOffers(myRes?.data ?? myRes?.offers ?? myRes ?? []);
            setRecvOffers(recvRes?.data ?? recvRes?.offers ?? recvRes ?? []);
        }).finally(() => setLoading(false));
    }, [isAuthenticated, authLoading, user, router]);

    const handleRespond = async (id: string, action: 'accept' | 'reject' | 'counter', counterPrice?: number) => {
        setRespondingId(id);
        try {
            await nodeApi.patch(`/offers/${id}/respond`, { action, counter_price: counterPrice });
            setRecvOffers(prev => prev.map(o => o.id === id
                ? { ...o, status: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'countered', counter_price: counterPrice }
                : o
            ));
            toast.success(action === 'accept' ? 'Offer accepted!' : action === 'reject' ? 'Offer rejected' : 'Counter offer sent!');
        } catch {
            toast.error('Could not respond to offer');
        } finally {
            setRespondingId(null);
        }
    };

    const isOwner = user?.role === 'owner';
    const pendingSent = sentOffers.filter(o => o.status === 'pending').length;
    const pendingRecv = recvOffers.filter(o => o.status === 'pending').length;

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 py-5 max-w-screen-xl">
                    <Link href="/browse" className="text-sm text-green-700 hover:text-green-800 flex items-center gap-1 font-medium mb-1 w-fit">
                        <ChevronLeft className="h-4 w-4" /> {t('nav.browse')}
                    </Link>
                    <h1 className="text-2xl lg:text-3xl font-black text-gray-900 flex items-center gap-2">
                        <Tag className="h-7 w-7 text-green-600" />
                        {t('offers.title')}
                    </h1>
                </div>

                {/* Tabs */}
                <div className="container mx-auto px-4 lg:px-8 max-w-screen-xl flex gap-1 pb-0">
                    {(['sent', 'received'] as const).filter(key => key === 'sent' || isOwner).map(key => (
                        <button key={key} type="button"
                            onClick={() => setTab(key)}
                            className={cn('px-5 py-3 text-sm font-semibold border-b-2 transition-colors capitalize flex items-center gap-1.5',
                                tab === key
                                    ? 'border-green-700 text-green-700'
                                    : 'border-transparent text-gray-500 hover:text-gray-700')}>
                            {key === 'sent' ? t('offers.myOffers') : t('offers.receivedOffers')}
                            {key === 'sent' && pendingSent > 0 && (
                                <span className="bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{pendingSent}</span>
                            )}
                            {key === 'received' && pendingRecv > 0 && (
                                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">{pendingRecv}</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 py-6 max-w-screen-xl">
                {loading ? (
                    <div className="space-y-3 max-w-2xl">
                        {[...Array(4)].map((_, i) => <SkeletonOffer key={i} />)}
                    </div>
                ) : tab === 'sent' ? (
                    sentOffers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center">
                            <div className="bg-green-50 rounded-full h-20 w-20 flex items-center justify-center mb-5">
                                <Tag className="h-10 w-10 text-green-300" />
                            </div>
                            <h2 className="text-xl font-black text-gray-700 mb-2">{t('offers.noOffersSent')}</h2>
                            <p className="text-gray-400 max-w-sm mb-6">
                                {t('offers.noOffersSentDesc')}
                            </p>
                            <Link href="/browse">
                                <Button className="bg-green-700 hover:bg-green-800 text-white rounded-2xl px-8">
                                    {t('home.browseEquipment')}
                                </Button>
                            </Link>
                        </div>
                    ) : (
                        <div className="space-y-3 max-w-2xl">
                            {sentOffers.map(o => (
                                <OfferCard key={o.id} offer={o} mode="sent" />
                            ))}
                        </div>
                    )
                ) : (
                    recvOffers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-24 text-center">
                            <div className="bg-indigo-50 rounded-full h-20 w-20 flex items-center justify-center mb-5">
                                <MessageSquare className="h-10 w-10 text-indigo-200" />
                            </div>
                            <h2 className="text-xl font-black text-gray-700 mb-2">{t('offers.noOffersReceived')}</h2>
                            <p className="text-gray-400 max-w-sm">
                                {t('offers.noOffersReceivedDesc')}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3 max-w-2xl">
                            {recvOffers.map(o => (
                                <OfferCard key={o.id} offer={o} mode="received"
                                    onRespond={respondingId ? undefined : handleRespond} />
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

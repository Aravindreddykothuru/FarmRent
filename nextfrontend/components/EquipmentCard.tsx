'use client';

import Link from 'next/link';
import { Star, MapPin, IndianRupee, Clock, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import FavoriteButton from '@/components/FavoriteButton';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

const FALLBACK = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=600&q=70';

export interface EquipmentCardData {
    id?: string;
    _id?: string;
    name: string;
    type?: string;
    status?: string;
    images?: string[];
    pricing?: { baseRatePerDay?: number; baseRatePerHour?: number };
    price?: number;
    location?: { village?: string; district?: string; state?: string; town?: string };
    avg_rating?: number;
    ratings?: { average?: number; count?: number };
    review_count?: number;
    distance_km?: number | null;
    features?: string[];
    operatorIncluded?: boolean;
}

interface Props {
    machine: EquipmentCardData;
    isFavorited?: boolean;
    variant?: 'grid' | 'list' | 'featured';
    className?: string;
    onFavoriteToggle?: (newState: boolean) => void;
}

export default function EquipmentCard({ machine, isFavorited = false, variant = 'grid', className, onFavoriteToggle }: Props) {
    const { t } = useLanguage();
    const id      = machine._id ?? machine.id ?? '';
    const price   = machine.pricing?.baseRatePerDay ?? machine.price ?? 0;
    const rating  = machine.avg_rating ?? machine.ratings?.average ?? 0;
    const reviews = machine.review_count ?? machine.ratings?.count ?? 0;
    const image   = machine.images?.filter(Boolean)[0] ?? FALLBACK;
    const loc     = machine.location;
    const locStr  = [loc?.village || loc?.town, loc?.district].filter(Boolean).join(', ') || loc?.state || '—';
    const typeStr = machine.type?.replace(/-/g, ' ') ?? '';
    const available = !machine.status || machine.status === 'available';

    if (variant === 'list') {
        return (
            <Link href={`/equipment/${id}`} className={cn('block group', className)}>
                <div className="flex gap-4 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:shadow-md hover:border-green-200 transition-all duration-200">
                    <div className="relative h-28 w-40 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
                        <img src={image} alt={machine.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />
                        <FavoriteButton equipmentId={id} initialFavorited={isFavorited} size="sm" className="absolute top-2 right-2" onToggle={onFavoriteToggle} />
                        {!available && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                <span className="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded-full">{t('equipment.unavailable')}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                            <div>
                                <p className="font-bold text-gray-900 leading-tight line-clamp-1">{machine.name}</p>
                                <Badge variant="secondary" className="text-[10px] capitalize mt-1 bg-green-50 text-green-700 border-0">{typeStr}</Badge>
                            </div>
                            <div className="text-right flex-shrink-0">
                                <div className="flex items-center gap-0.5 text-green-700 font-extrabold">
                                    <IndianRupee className="h-3.5 w-3.5" />
                                    <span className="text-lg">{price.toLocaleString('en-IN')}</span>
                                </div>
                                <span className="text-[11px] text-gray-400">{t('equipment.perDay')}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 mt-2">
                            {rating > 0 && (
                                <span className="flex items-center gap-0.5">
                                    <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                                    <span className="font-semibold text-gray-700">{rating.toFixed(1)}</span>
                                    <span className="text-gray-400">({reviews})</span>
                                </span>
                            )}
                            <span className="flex items-center gap-0.5">
                                <MapPin className="h-3 w-3 text-green-600" /> {locStr}
                            </span>
                            {machine.distance_km != null && (
                                <span className="flex items-center gap-0.5 font-semibold text-indigo-600">
                                    <Zap className="h-3 w-3" />
                                    {machine.distance_km < 1 ? t('equipment.lessThan1km') : t('equipment.kmAway', { km: machine.distance_km.toFixed(1) })}
                                </span>
                            )}
                        </div>
                        {machine.features && machine.features.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                                {machine.features.slice(0, 2).map((f, i) => (
                                    <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{f}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Link>
        );
    }

    // Grid / Featured variant
    return (
        <Link href={`/equipment/${id}`} className={cn('block group', className)}>
            <div className={cn(
                'bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer',
                variant === 'featured' && 'rounded-3xl'
            )}>
                {/* Image */}
                <div className={cn('relative overflow-hidden bg-gray-100', variant === 'featured' ? 'h-52' : 'h-44')}>
                    <img src={image} alt={machine.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK; }} />

                    {/* Overlay gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Top badges */}
                    <div className="absolute top-3 left-3 right-3 flex items-start justify-between">
                        <Badge className="bg-white/95 text-gray-700 border-0 text-[10px] font-semibold capitalize shadow-sm">{typeStr || t('equipment.generic')}</Badge>
                        <FavoriteButton equipmentId={id} initialFavorited={isFavorited} size="sm" onToggle={onFavoriteToggle} />
                    </div>

                    {/* Distance badge */}
                    {machine.distance_km != null && (
                        <div className="absolute bottom-3 left-3">
                            <span className="flex items-center gap-1 bg-indigo-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md">
                                <Zap className="h-2.5 w-2.5" />
                                {machine.distance_km < 1 ? t('equipment.lessThan1kmAway') : t('equipment.kmAway', { km: machine.distance_km.toFixed(1) })}
                            </span>
                        </div>
                    )}

                    {/* Unavailable overlay */}
                    {!available && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="text-white text-xs font-bold bg-black/60 px-3 py-1.5 rounded-full">{t('equipment.unavailable')}</span>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="p-4">
                    {/* Rating */}
                    {rating > 0 ? (
                        <div className="flex items-center gap-1 mb-1.5">
                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-xs font-bold text-gray-800">{rating.toFixed(1)}</span>
                            <span className="text-[11px] text-gray-400">({reviews})</span>
                        </div>
                    ) : (
                        <div className="mb-1.5">
                            <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{t('equipment.newListing')}</span>
                        </div>
                    )}

                    <p className="font-bold text-gray-900 text-sm leading-tight line-clamp-2 mb-1">{machine.name}</p>

                    <div className="flex items-center gap-1 text-[11px] text-gray-500 mb-3">
                        <MapPin className="h-3 w-3 text-green-600 flex-shrink-0" />
                        <span className="truncate">{locStr}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-baseline gap-0.5 text-green-700">
                            <IndianRupee className="h-3.5 w-3.5 font-bold" />
                            <span className="text-lg font-extrabold">{price.toLocaleString('en-IN')}</span>
                            <span className="text-[11px] text-gray-400 font-normal ml-0.5">{t('equipment.perDay')}</span>
                        </div>
                        {machine.pricing?.baseRatePerHour && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <Clock className="h-2.5 w-2.5" />
                                ₹{machine.pricing.baseRatePerHour.toLocaleString('en-IN')}/hr
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
}

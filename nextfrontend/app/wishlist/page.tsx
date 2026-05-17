'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import EquipmentCard, { type EquipmentCardData } from '@/components/EquipmentCard';
import { Heart, BookmarkX, ChevronLeft, Loader2 } from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';

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

export default function WishlistPage() {
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const [items, setItems] = useState<EquipmentCardData[]>([]);
    const [loading, setLoading] = useState(true);
    const [removing, setRemoving] = useState<string | null>(null);

    useEffect(() => {
        if (authLoading) return;
        if (!isAuthenticated) { router.replace('/login?next=/wishlist'); return; }
        nodeApi.get<any>('/favorites')
            .then(r => setItems(r?.data ?? r?.favorites ?? r ?? []))
            .catch(() => toast.error('Could not load wishlist'))
            .finally(() => setLoading(false));
    }, [isAuthenticated, authLoading, router]);

    const handleRemove = async (id: string) => {
        setRemoving(id);
        try {
            await nodeApi.delete(`/favorites/${id}`);
            setItems(prev => prev.filter(m => (m._id ?? m.id) !== id));
            toast.success('Removed from wishlist');
        } catch {
            toast.error('Could not remove item');
        } finally {
            setRemoving(null);
        }
    };

    if (authLoading || loading) return (
        <div className="min-h-screen bg-[#F7F8FA]">
            <div className="bg-white border-b px-4 py-6">
                <Skeleton className="h-8 w-48" />
            </div>
            <div className="container mx-auto px-4 lg:px-8 py-8 max-w-screen-xl">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
                </div>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            {/* Header */}
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="container mx-auto px-4 lg:px-8 py-5 max-w-screen-xl flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-0.5">
                            <Link href="/browse" className="text-sm text-green-700 hover:text-green-800 flex items-center gap-1 font-medium">
                                <ChevronLeft className="h-4 w-4" /> {t('nav.browse')}
                            </Link>
                        </div>
                        <h1 className="text-2xl lg:text-3xl font-black text-gray-900 flex items-center gap-2">
                            <Heart className="h-7 w-7 text-red-500 fill-red-500" />
                            {t('wishlist.title')}
                            {items.length > 0 && (
                                <span className="text-lg font-semibold text-gray-400">({items.length})</span>
                            )}
                        </h1>
                    </div>
                    {items.length > 0 && (
                        <Link href="/browse">
                            <Button variant="outline" className="border-green-200 text-green-700 hover:bg-green-50">
                                {t('wishlist.browseMore')}
                            </Button>
                        </Link>
                    )}
                </div>
            </div>

            <div className="container mx-auto px-4 lg:px-8 py-8 max-w-screen-xl">
                {items.length === 0 ? (
                    /* Empty state */
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                        <div className="bg-red-50 rounded-full h-24 w-24 flex items-center justify-center mb-6">
                            <Heart className="h-12 w-12 text-red-300" />
                        </div>
                        <h2 className="text-2xl font-black text-gray-800 mb-2">{t('wishlist.empty')}</h2>
                        <p className="text-gray-500 max-w-sm mb-8">
                            {t('wishlist.emptyDesc')}
                        </p>
                        <Link href="/browse">
                            <Button className="bg-green-700 hover:bg-green-800 text-white px-8 h-12 rounded-2xl text-base font-bold">
                                {t('home.browseEquipment')}
                            </Button>
                        </Link>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {items.map(m => {
                            const id = m._id ?? m.id ?? '';
                            return (
                                <div key={id} className="relative group">
                                    <EquipmentCard machine={m} isFavorited variant="grid"
                                        onFavoriteToggle={(newState: boolean) => {
                                            if (!newState) setItems(prev => prev.filter(x => (x._id ?? x.id) !== id));
                                        }}
                                    />
                                    {/* Overlay remove button */}
                                    <button type="button" aria-label="Remove from wishlist"
                                        onClick={() => handleRemove(id)}
                                        disabled={removing === id}
                                        className="absolute top-3 right-3 z-10 bg-red-500 hover:bg-red-600 text-white h-8 w-8 rounded-full flex items-center justify-center shadow-md transition-all opacity-0 group-hover:opacity-100 disabled:opacity-50">
                                        {removing === id
                                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : <BookmarkX className="h-3.5 w-3.5" />}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

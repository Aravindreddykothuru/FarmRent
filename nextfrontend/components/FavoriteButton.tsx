'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    equipmentId: string;
    initialFavorited?: boolean;
    size?: 'sm' | 'md';
    className?: string;
    onToggle?: (newState: boolean) => void;
}

export default function FavoriteButton({ equipmentId, initialFavorited = false, size = 'md', className, onToggle }: Props) {
    const { isAuthenticated } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    const [favorited, setFavorited] = useState(initialFavorited);
    const [loading, setLoading] = useState(false);

    const toggle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated) { router.push('/login'); return; }
        if (loading) return;
        setLoading(true);
        const next = !favorited;
        setFavorited(next);
        try {
            if (next) {
                await nodeApi.post(`/favorites/${equipmentId}`, {});
                toast.success(t('equipment.addedWishlist'));
            } else {
                await nodeApi.delete(`/favorites/${equipmentId}`);
                toast.success(t('equipment.removedWishlist'));
            }
            onToggle?.(next);
        } catch {
            setFavorited(!next);
            toast.error(t('equipment.wishlistError'));
        } finally {
            setLoading(false);
        }
    };

    const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
    const btnSize  = size === 'sm' ? 'h-7 w-7'     : 'h-9 w-9';

    return (
        <button
            type="button"
            aria-label={favorited ? t('equipment.removeFromWishlist') : t('equipment.addToWishlist')}
            onClick={toggle}
            disabled={loading}
            className={cn(
                'flex items-center justify-center rounded-full transition-all shadow-md backdrop-blur-sm',
                favorited
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-white/90 text-gray-500 hover:bg-white hover:text-red-500',
                btnSize,
                className
            )}
        >
            <Heart className={cn(iconSize, favorited && 'fill-white')} />
        </button>
    );
}

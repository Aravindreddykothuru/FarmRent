'use client';
/**
 * LiveETABadge.tsx — Animated ETA display with OSRM vs estimate indicator
 *
 * Upgrades:
 *  • Shows OSRM badge when ETA came from a real road route
 *  • Animated pulse when freshly updated
 *  • Distance display alongside ETA
 *  • Staleness indicator (fades if not updated in > 30s)
 */

import { useEffect, useState } from 'react';
import { Clock, Navigation, Zap } from 'lucide-react';

interface Props {
    eta_minutes?:   number | null;
    liveEta?:       number | null;
    liveDistKm?:    number | null;
    lastUpdatedAt?: number | null;
    isOsrm?:        boolean;
}

export default function LiveETABadge({
    eta_minutes, liveEta, liveDistKm, lastUpdatedAt, isOsrm = false,
}: Props) {
    const eta  = liveEta ?? eta_minutes;
    const [fresh, setFresh] = useState(false);
    const [stale, setStale] = useState(false);

    // Animate on update
    useEffect(() => {
        if (!lastUpdatedAt) return;
        setFresh(true);
        setStale(false);
        const timer = setTimeout(() => setFresh(false), 1500);
        // Mark stale after 45s without update
        const staleTimer = setTimeout(() => setStale(true), 45_000);
        return () => { clearTimeout(timer); clearTimeout(staleTimer); };
    }, [lastUpdatedAt]);

    if (eta == null) return null;

    const etaDisplay = eta < 1 ? 'Arriving…' : eta === 1 ? '1 min' : `${eta} min`;
    const updatedStr = lastUpdatedAt
        ? new Date(lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : null;

    return (
        <div
            className="flex flex-col items-center gap-1"
            style={{ opacity: stale ? 0.6 : 1, transition: 'opacity 0.5s' }}
        >
            {/* Main badge */}
            <div
                className="flex items-center gap-3 rounded-2xl px-6 py-4 shadow-lg"
                style={{
                    background: fresh
                        ? 'linear-gradient(135deg, #15803d, #16a34a)'
                        : 'linear-gradient(135deg, #1e293b, #334155)',
                    border: `1px solid ${fresh ? '#16a34a' : '#475569'}`,
                    transition: 'background 0.6s, border-color 0.6s',
                    boxShadow: fresh ? '0 0 20px rgba(22,163,74,0.35)' : '0 4px 20px rgba(0,0,0,0.2)',
                }}
            >
                {/* ETA */}
                <div className="text-center">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">ETA</span>
                        {isOsrm && (
                            <span className="flex items-center gap-0.5 text-xs text-green-400 font-medium">
                                <Zap className="w-3 h-3" />
                                OSRM
                            </span>
                        )}
                    </div>
                    <div className="text-3xl font-extrabold text-white tracking-tight">
                        {etaDisplay}
                    </div>
                </div>

                {/* Divider */}
                {liveDistKm != null && (
                    <>
                        <div className="w-px h-12 bg-slate-500" />
                        <div className="text-center">
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <Navigation className="w-4 h-4 text-purple-400" />
                                <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Distance</span>
                            </div>
                            <div className="text-3xl font-extrabold text-white tracking-tight">
                                {liveDistKm < 1
                                    ? `${Math.round(liveDistKm * 1000)}m`
                                    : `${liveDistKm.toFixed(1)}km`}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Last updated row */}
            {updatedStr && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <div className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-amber-400' : 'bg-green-400 animate-pulse'}`} />
                    {stale ? 'Updating…' : `Updated ${updatedStr}`}
                    {isOsrm && !stale && (
                        <span className="text-green-500 font-medium">· Road route</span>
                    )}
                </div>
            )}
        </div>
    );
}

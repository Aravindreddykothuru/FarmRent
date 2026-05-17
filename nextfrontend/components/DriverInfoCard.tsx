'use client';
/**
 * DriverInfoCard.tsx — Upgraded with live speed, heading, GPS quality badges
 */

import { Phone, Star, Truck, User, ShieldCheck, Navigation } from 'lucide-react';

interface Driver {
    id:             string;
    vehicle_name:   string;
    vehicle_type:   string;
    vehicle_number: string;
    rating?:        number;
    total_trips?:   number;
    users?:         { name?: string; phone?: string };
}

interface Props {
    driver:       Driver | null;
    eta_minutes?: number | null;
    distance_km?: number | null;
    speed?:       number | null;
    heading?:     number | null;
    isLive?:      boolean;
}

function headingLabel(deg: number): string {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export default function DriverInfoCard({ driver, eta_minutes, distance_km, speed, heading, isLive }: Props) {
    if (!driver) return null;

    const name   = driver.users?.name  || 'Driver';
    const phone  = driver.users?.phone || null;
    const rating = driver.rating ?? 5.0;
    const trips  = driver.total_trips ?? 0;

    return (
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 overflow-hidden">

            {/* Live banner */}
            {isLive && (
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                    <span className="text-white text-xs font-semibold tracking-wide uppercase">Driver Tracking Active</span>
                    {speed != null && speed > 0 && (
                        <span className="ml-auto text-green-100 text-xs font-medium">
                            {speed.toFixed(1)} km/h
                        </span>
                    )}
                </div>
            )}

            <div className="p-4 space-y-3">
                {/* Header row */}
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                        <User className="w-6 h-6 text-green-700" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">{name}</p>
                        <div className="flex items-center gap-1 text-sm text-amber-500">
                            <Star className="w-3.5 h-3.5 fill-amber-400" />
                            <span className="font-medium">{rating.toFixed(1)}</span>
                            <span className="text-gray-400 text-xs">({trips} trips)</span>
                        </div>
                    </div>
                    {!isLive && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-full">
                            Offline
                        </span>
                    )}
                </div>

                {/* Vehicle info */}
                <div className="flex items-center gap-2.5 bg-gray-50 rounded-xl p-3">
                    <Truck className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{driver.vehicle_name}</p>
                        <p className="text-xs text-gray-500">{driver.vehicle_type} · {driver.vehicle_number}</p>
                    </div>
                </div>

                {/* ETA + Distance + Speed grid */}
                <div className="grid grid-cols-3 gap-2 text-center">
                    {eta_minutes != null && (
                        <div className="bg-blue-50 rounded-xl py-2 px-1">
                            <p className="text-lg font-bold text-blue-700">{eta_minutes}</p>
                            <p className="text-xs text-blue-500">min ETA</p>
                        </div>
                    )}
                    {distance_km != null && (
                        <div className="bg-purple-50 rounded-xl py-2 px-1">
                            <p className="text-lg font-bold text-purple-700">
                                {distance_km < 1 ? `${Math.round(distance_km * 1000)}m` : `${distance_km.toFixed(1)}`}
                            </p>
                            <p className="text-xs text-purple-500">
                                {distance_km < 1 ? 'meters' : 'km'}
                            </p>
                        </div>
                    )}
                    {speed != null && (
                        <div className="bg-orange-50 rounded-xl py-2 px-1">
                            <p className="text-lg font-bold text-orange-700">{speed.toFixed(0)}</p>
                            <p className="text-xs text-orange-500">km/h</p>
                        </div>
                    )}
                </div>

                {/* Heading if available */}
                {heading != null && speed != null && speed > 2 && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Navigation
                            className="w-3.5 h-3.5 text-green-600 flex-shrink-0"
                            style={{ transform: `rotate(${heading}deg)` }}
                        />
                        <span>Heading {headingLabel(heading)} ({Math.round(heading)}°)</span>
                    </div>
                )}

                {/* Call driver */}
                {phone && (
                    <a
                        href={`tel:${phone}`}
                        className="flex items-center justify-center gap-2 w-full bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                    >
                        <Phone className="w-4 h-4" />
                        Call Driver
                    </a>
                )}

                {/* Verified badge */}
                <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Verified professional driver
                </div>
            </div>
        </div>
    );
}

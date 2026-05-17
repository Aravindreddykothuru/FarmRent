'use client';

import { useEffect, useState } from 'react';
import { Wind, Droplets, Thermometer } from 'lucide-react';

interface OmWeather {
    current: {
        temperature_2m: number;
        weather_code: number;
        wind_speed_10m: number;
        relative_humidity_2m: number;
    };
    daily: {
        time: string[];
        weather_code: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_sum: number[];
    };
}

interface WeatherInfo { icon: string; label: string; farmingTip?: string; tipColor?: string }

function codeToInfo(c: number): WeatherInfo {
    if (c === 0)        return { icon: '☀️', label: 'Clear Sky',      farmingTip: '✅ Great day for field operations', tipColor: 'green' };
    if (c <= 3)         return { icon: '⛅', label: 'Partly Cloudy',   farmingTip: '✅ Good conditions for equipment use', tipColor: 'green' };
    if (c <= 48)        return { icon: '🌫️', label: 'Foggy',           farmingTip: '⚠️ Reduced visibility — drive carefully', tipColor: 'yellow' };
    if (c <= 57)        return { icon: '🌦️', label: 'Drizzle',         farmingTip: '⚠️ Light rain — check equipment covers', tipColor: 'yellow' };
    if (c <= 67)        return { icon: '🌧️', label: 'Rainy',           farmingTip: '⛔ Heavy rain — postpone field work if possible', tipColor: 'red' };
    if (c <= 77)        return { icon: '❄️', label: 'Snowy' };
    if (c <= 82)        return { icon: '🌦️', label: 'Rain Showers',    farmingTip: '⚠️ Rain showers expected — plan bookings accordingly', tipColor: 'yellow' };
    if (c === 95)       return { icon: '⛈️', label: 'Thunderstorm',    farmingTip: '⛔ Thunderstorm — avoid outdoor operations', tipColor: 'red' };
    if (c >= 96)        return { icon: '🌩️', label: 'Hailstorm',       farmingTip: '⛔ Hail possible — shelter equipment', tipColor: 'red' };
    return              { icon: '🌡️', label: 'Variable' };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIP_STYLE: Record<string, string> = {
    green:  'bg-green-500/10 text-green-700',
    yellow: 'bg-amber-500/10 text-amber-700',
    red:    'bg-red-500/10 text-red-700',
};

interface WeatherWidgetProps {
    latitude?: number;
    longitude?: number;
    district?: string;
}

export default function WeatherWidget({ latitude, longitude, district }: WeatherWidgetProps) {
    const [weather,  setWeather]  = useState<OmWeather | null>(null);
    const [loading,  setLoading]  = useState(true);
    const [lat,      setLat]      = useState(latitude  ?? 20.5937);
    const [lng,      setLng]      = useState(longitude ?? 78.9629);

    // Try browser geolocation if no coords passed
    useEffect(() => {
        if (latitude && longitude) { setLat(latitude); setLng(longitude); return; }
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                p => { setLat(p.coords.latitude); setLng(p.coords.longitude); },
                () => {} // stay on India center
            );
        }
    }, [latitude, longitude]);

    useEffect(() => {
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${lat}&longitude=${lng}` +
            `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
            `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
            `&timezone=Asia%2FKolkata&forecast_days=5`;

        fetch(url)
            .then(r => r.json())
            .then((d: OmWeather) => { setWeather(d); setLoading(false); })
            .catch(() => setLoading(false));
    }, [lat, lng]);

    if (loading) {
        return (
            <div className="bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl p-4 border border-sky-100 animate-pulse">
                <div className="h-3 bg-sky-100 rounded w-28 mb-3" />
                <div className="h-10 bg-sky-100 rounded w-24 mb-3" />
                <div className="grid grid-cols-5 gap-1">
                    {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-sky-100 rounded-xl" />)}
                </div>
            </div>
        );
    }

    if (!weather) return null;

    const { current, daily } = weather;
    const { icon, label, farmingTip, tipColor } = codeToInfo(current.weather_code);

    return (
        <div className="bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 rounded-2xl p-4 border border-sky-100">
            {/* Header row */}
            <div className="flex items-start justify-between mb-3">
                <div>
                    <p className="text-xs text-sky-600 font-semibold mb-1">
                        🌤 {district ? `Weather · ${district}` : 'Local Weather'} · IMD
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-gray-800">{Math.round(current.temperature_2m)}°C</span>
                        <span className="text-2xl">{icon}</span>
                    </div>
                    <p className="text-sm text-gray-600 font-semibold mt-0.5">{label}</p>
                </div>
                <div className="space-y-1.5 text-right">
                    <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
                        <Wind className="h-3 w-3 text-sky-400" />
                        <span>{Math.round(current.wind_speed_10m)} km/h</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
                        <Droplets className="h-3 w-3 text-blue-400" />
                        <span>{current.relative_humidity_2m}% humidity</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs text-gray-500">
                        <Thermometer className="h-3 w-3 text-orange-400" />
                        <span>Feels {Math.round(current.temperature_2m - 2)}°</span>
                    </div>
                </div>
            </div>

            {/* 5-day forecast */}
            <div className="grid grid-cols-5 gap-1.5 mb-3">
                {daily.time.slice(0, 5).map((dateStr, i) => {
                    const d = new Date(dateStr);
                    const dayLabel = i === 0 ? 'Today' : DAYS[d.getDay()];
                    const { icon: di } = codeToInfo(daily.weather_code[i]);
                    const rain = daily.precipitation_sum[i] ?? 0;
                    return (
                        <div
                            key={dateStr}
                            className={`text-center bg-white/70 rounded-xl py-2 px-0.5 border ${i === 0 ? 'border-sky-200 bg-white/90' : 'border-white/50'}`}
                        >
                            <p className="text-[10px] text-gray-500 font-semibold">{dayLabel}</p>
                            <span className="text-lg leading-none block my-0.5">{di}</span>
                            <p className="text-[11px] font-bold text-gray-700">{Math.round(daily.temperature_2m_max[i])}°</p>
                            <p className="text-[10px] text-gray-400">{Math.round(daily.temperature_2m_min[i])}°</p>
                            {rain > 0.5 && (
                                <p className="text-[9px] text-blue-600 font-bold">{rain.toFixed(1)}mm</p>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Farming tip */}
            {farmingTip && tipColor && (
                <div className={`rounded-xl px-3 py-2 ${TIP_STYLE[tipColor]}`}>
                    <p className="text-xs font-semibold">{farmingTip}</p>
                </div>
            )}
        </div>
    );
}

'use client';

import { useMemo } from 'react';

interface BookedRange {
    start_date: string;
    end_date: string;
}

interface Props {
    bookedRanges: BookedRange[];
    readonly?: boolean;
}

function getDatesInRange(start: string, end: string): string[] {
    const dates: string[] = [];
    const s = new Date(start);
    const e = new Date(end);
    s.setHours(0, 0, 0, 0);
    e.setHours(0, 0, 0, 0);
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
}

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function AvailabilityCalendar({ bookedRanges, readonly: _readonly = true }: Props) {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();

    const bookedSet = useMemo(() => {
        const set = new Set<string>();
        for (const r of bookedRanges) {
            for (const d of getDatesInRange(r.start_date, r.end_date)) {
                set.add(d);
            }
        }
        return set;
    }, [bookedRanges]);

    const todayStr = today.toISOString().split('T')[0];
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);

    const cells: (number | null)[] = [
        ...Array(firstDay).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4 w-full max-w-xs">
            <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm text-gray-800">
                    {MONTHS[month]} {year}
                </span>
                <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-400 inline-block" />Booked</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-100 border border-green-400 inline-block" />Free</span>
                </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center">
                {DAYS.map(d => (
                    <div key={d} className="text-xs text-gray-400 font-medium py-1">{d}</div>
                ))}
                {cells.map((day, i) => {
                    if (!day) return <div key={`e-${i}`} />;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isBooked = bookedSet.has(dateStr);
                    const isToday = dateStr === todayStr;
                    const isPast = dateStr < todayStr;

                    return (
                        <div
                            key={day}
                            className={[
                                'text-xs py-1.5 rounded-md font-medium transition-colors',
                                isBooked ? 'bg-red-100 text-red-600' : '',
                                !isBooked && !isPast ? 'bg-green-50 text-green-700 hover:bg-green-100' : '',
                                isPast && !isBooked ? 'text-gray-300' : '',
                                isToday ? 'ring-2 ring-green-500 ring-offset-1' : '',
                            ].filter(Boolean).join(' ')}
                        >
                            {day}
                        </div>
                    );
                })}
            </div>

            {bookedRanges.length === 0 && (
                <p className="text-xs text-center text-gray-400 mt-3">No bookings yet — all dates available</p>
            )}
        </div>
    );
}

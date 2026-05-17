'use client';
import { CheckCircle2, Clock, Truck, Star } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const ORDER = ['requested', 'accepted', 'in_progress', 'completed'];

export default function BookingStatusBar({ status }: { status: string }) {
    const { t } = useLanguage();

    const STEPS = [
        { key: 'requested',   label: t('booking.bookingPending'),  icon: Clock },
        { key: 'accepted',    label: t('booking.bookingConfirmed'), icon: Star },
        { key: 'in_progress', label: t('booking.active'),           icon: Truck },
        { key: 'completed',   label: t('booking.completed'),        icon: CheckCircle2 },
    ];

    const currentIdx = ORDER.indexOf(status);

    return (
        <div className="w-full px-2 py-4">
            <div className="flex items-center justify-between relative">
                {/* Progress line */}
                <div className="absolute top-5 left-0 right-0 h-1 bg-gray-200 z-0" />
                <div
                    className="absolute top-5 left-0 h-1 bg-green-500 z-0 transition-all duration-700"
                    style={{ width: currentIdx >= 0 ? `${(currentIdx / (STEPS.length - 1)) * 100}%` : '0%' }}
                />

                {STEPS.map((step, idx) => {
                    const Icon = step.icon;
                    const done    = idx < currentIdx;
                    const active  = idx === currentIdx;
                    const pending = idx > currentIdx;
                    const cancelled = status === 'cancelled';

                    return (
                        <div key={step.key} className="flex flex-col items-center z-10 flex-1">
                            <div className={`
                                w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-500
                                ${cancelled && active ? 'bg-red-100 border-red-400 text-red-500' : ''}
                                ${done    ? 'bg-green-500 border-green-500 text-white' : ''}
                                ${active && !cancelled ? 'bg-white border-green-500 text-green-600 shadow-lg scale-110' : ''}
                                ${pending ? 'bg-gray-100 border-gray-200 text-gray-400' : ''}
                            `}>
                                <Icon className="w-4 h-4" />
                            </div>
                            <span className={`mt-2 text-xs font-medium text-center
                                ${done    ? 'text-green-600' : ''}
                                ${active && !cancelled ? 'text-green-700 font-semibold' : ''}
                                ${pending ? 'text-gray-400' : ''}
                                ${cancelled && active ? 'text-red-500' : ''}
                            `}>
                                {step.label}
                            </span>
                        </div>
                    );
                })}
            </div>
            {status === 'cancelled' && (
                <p className="text-center text-sm text-red-500 mt-3 font-medium">{t('booking.bookingCancelled')}</p>
            )}
        </div>
    );
}

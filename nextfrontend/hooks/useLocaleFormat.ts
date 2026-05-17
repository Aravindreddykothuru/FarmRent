'use client';

import { useLanguage } from '@/context/LanguageContext';

// Maps our LangCode to BCP 47 locale for Intl APIs
const INTL_LOCALE: Record<string, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    kn: 'kn-IN',
    te: 'te-IN',
    ta: 'ta-IN',
    mr: 'mr-IN',
    pa: 'pa-IN',
    bn: 'bn-IN',
    gu: 'gu-IN',
    ml: 'ml-IN',
    raj: 'hi-IN',
    or:  'or-IN',
};

export function useLocaleFormat() {
    const { lang } = useLanguage();
    const intlLocale = INTL_LOCALE[lang] ?? 'en-IN';

    const formatCurrency = (amount: number): string => {
        try {
            return new Intl.NumberFormat(intlLocale, {
                style:    'currency',
                currency: 'INR',
                maximumFractionDigits: 0,
            }).format(amount);
        } catch {
            return `₹${amount.toLocaleString('en-IN')}`;
        }
    };

    const formatNumber = (n: number): string => {
        try {
            return new Intl.NumberFormat(intlLocale).format(n);
        } catch {
            return String(n);
        }
    };

    const formatDate = (date: Date | string, opts?: Intl.DateTimeFormatOptions): string => {
        const d = typeof date === 'string' ? new Date(date) : date;
        try {
            return new Intl.DateTimeFormat(intlLocale, opts ?? {
                day:   '2-digit',
                month: 'short',
                year:  'numeric',
            }).format(d);
        } catch {
            return d.toLocaleDateString('en-IN');
        }
    };

    const formatDateRange = (start: Date | string, end: Date | string): string => {
        return `${formatDate(start)} – ${formatDate(end)}`;
    };

    return { formatCurrency, formatNumber, formatDate, formatDateRange, intlLocale };
}

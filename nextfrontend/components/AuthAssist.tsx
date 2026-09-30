'use client';

/**
 * Small helpers shared by the login and register screens.
 *
 * Both exist for the same audience: farmers on an Android phone, often on a slow
 * connection, who may not read English. So both are sized for thumbs (48px targets)
 * and set in body-size text rather than the fine print the rest of the app uses.
 */

import Link from 'next/link';
import { Phone } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_E164 } from '@/lib/contact';

/** The three languages the spec calls out. The rest stay one tap away on /select-language. */
const QUICK_LANGS = [
    { code: 'en' as const, label: 'English' },
    { code: 'te' as const, label: 'తెలుగు' },
    { code: 'hi' as const, label: 'हिंदी' },
];

export function LanguageQuickBar({ next }: { next: string }) {
    const { lang, setLang, markChosen, t } = useLanguage();

    return (
        <div className="mb-6">
            <div role="group" aria-label={t('auth.chooseLanguage')} className="grid grid-cols-3 gap-2">
                {QUICK_LANGS.map(l => {
                    const active = lang === l.code;
                    return (
                        <button
                            key={l.code}
                            type="button"
                            suppressHydrationWarning
                            aria-pressed={active}
                            onClick={() => { setLang(l.code); markChosen(); }}
                            className={`h-12 rounded-xl border-2 text-base font-bold transition-colors ${
                                active
                                    ? 'border-green-700 bg-green-700 text-white'
                                    : 'border-gray-300 bg-white text-gray-800 hover:border-green-500 hover:bg-green-50'
                            }`}
                        >
                            {l.label}
                        </button>
                    );
                })}
            </div>
            <Link
                href={`/select-language?next=${next}`}
                className="mt-2 inline-flex h-11 items-center text-base font-semibold text-green-800 underline underline-offset-2"
            >
                {t('auth.moreLanguages')}
            </Link>
        </div>
    );
}

export function NeedHelpButton() {
    const { t } = useLanguage();

    return (
        // Stacks on a narrow phone so the label and the number each stay on one line,
        // and sits inline once there is room for both.
        <a
            href={`tel:${SUPPORT_PHONE_E164}`}
            className="mt-6 flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-gray-300 bg-gray-50 px-4 py-2 text-base font-bold text-gray-800 transition-colors hover:border-green-500 hover:bg-green-50 hover:text-green-800 sm:flex-row sm:gap-2"
        >
            <span className="flex items-center gap-2">
                <Phone className="h-5 w-5 flex-shrink-0 text-green-700" aria-hidden="true" />
                {t('auth.needHelp')}
            </span>
            <span className="whitespace-nowrap font-black text-green-800">{SUPPORT_PHONE_DISPLAY}</span>
        </a>
    );
}

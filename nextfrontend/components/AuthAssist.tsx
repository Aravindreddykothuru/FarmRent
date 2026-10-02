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

/**
 * Login sits on a dark glass card, register on white. Rather than two copies of each control, both take a
 * tone and default to light, so the register screen is untouched by the login restyle.
 */
export type Tone = 'light' | 'dark';

/** The three languages the spec calls out. The rest stay one tap away on /select-language. */
const QUICK_LANGS = [
    { code: 'en' as const, label: 'English' },
    { code: 'te' as const, label: 'తెలుగు' },
    { code: 'hi' as const, label: 'हिंदी' },
];

export function LanguageQuickBar({ next, tone = 'light' }: { next: string; tone?: Tone }) {
    const { lang, setLang, markChosen, t } = useLanguage();
    const dark = tone === 'dark';

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
                                    ? dark
                                        ? 'border-green-400 bg-green-600 text-white'
                                        : 'border-green-700 bg-green-700 text-white'
                                    : dark
                                      ? 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
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
                className={`mt-2 inline-flex h-11 items-center text-base font-semibold underline underline-offset-2 ${
                    dark ? 'text-green-200 hover:text-white' : 'text-green-800'
                }`}
            >
                {t('auth.moreLanguages')}
            </Link>
        </div>
    );
}

export function NeedHelpButton({ tone = 'light' }: { tone?: Tone } = {}) {
    const { t } = useLanguage();
    const dark = tone === 'dark';

    return (
        // Stacks on a narrow phone so the label and the number each stay on one line,
        // and sits inline once there is room for both.
        <a
            href={`tel:${SUPPORT_PHONE_E164}`}
            className={`mt-6 flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-4 py-2 text-base font-bold transition-colors sm:flex-row sm:gap-2 ${
                dark
                    ? 'border-white/20 bg-white/5 text-green-50 hover:border-green-300 hover:bg-white/10'
                    : 'border-gray-300 bg-gray-50 text-gray-800 hover:border-green-500 hover:bg-green-50 hover:text-green-800'
            }`}
        >
            <span className="flex items-center gap-2">
                <Phone className={`h-5 w-5 flex-shrink-0 ${dark ? 'text-green-300' : 'text-green-700'}`} aria-hidden="true" />
                {t('auth.needHelp')}
            </span>
            <span className={`whitespace-nowrap font-black ${dark ? 'text-green-200' : 'text-green-800'}`}>{SUPPORT_PHONE_DISPLAY}</span>
        </a>
    );
}

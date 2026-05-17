'use client';

import { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown, Volume2 } from 'lucide-react';
import { LANGUAGES, useLanguage, type LangCode } from '@/context/LanguageContext';
import { MAJOR_LOCALES, OTHER_LOCALES, LOCALE_META, SUPPORTED_LOCALES, type Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

// ── "Choose your language" phrase in each language (for the modal voice button) ─
const CHOOSE_PHRASE: Partial<Record<LangCode, string>> = {
    en:  'Choose your language',
    hi:  'अपनी भाषा चुनें',
    kn:  'ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ',
    te:  'మీ భాష ఎంచుకోండి',
    ta:  'உங்கள் மொழியை தேர்ந்தெடுக்கவும்',
    mr:  'आपली भाषा निवडा',
    pa:  'ਆਪਣੀ ਭਾਸ਼ਾ ਚੁਣੋ',
    bn:  'আপনার ভাষা বেছে নিন',
    gu:  'તમારી ભાષા પસંદ કરો',
    ml:  'നിങ്ങളുടെ ഭാഷ തിരഞ്ഞെടുക്കുക',
};

function speak(text: string, bcp47: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang  = bcp47;
    u.rate  = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const match  = voices.find(v => v.lang.startsWith(bcp47.split('-')[0]));
    if (match) u.voice = match;
    window.speechSynthesis.speak(u);
}

// ── Full-screen first-launch modal ────────────────────────────────────────────
export function LanguageModal() {
    const { lang, setLang, hasChosen, markChosen, t } = useLanguage();
    const [visible, setVisible] = useState(false);

    // Show only after hydration (avoids SSR mismatch)
    useEffect(() => {
        if (!hasChosen) setVisible(true);
    }, [hasChosen]);

    if (!visible) return null;

    const pick = (code: LangCode) => {
        setLang(code);
        markChosen();
        setVisible(false);
    };

    const majorLangs = LANGUAGES.filter(l =>
        MAJOR_LOCALES.includes(l.code as Locale) || l.code === 'en'
    );
    const otherLangs = LANGUAGES.filter(l =>
        (OTHER_LOCALES.includes(l.code as Locale) && l.code !== 'en') ||
        l.code === 'raj' || l.code === 'or'
    );

    return (
        <div className="fixed inset-0 z-[9999] bg-gradient-to-b from-green-950 via-green-900 to-green-800 flex flex-col items-center justify-start overflow-y-auto">
            {/* Header */}
            <div className="w-full max-w-lg px-5 pt-12 pb-6 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-5">
                    <Globe className="h-8 w-8 text-white" />
                </div>
                <h1 className="text-2xl font-black text-white mb-1">
                    भाषा चुनें · Choose Language
                </h1>
                <p className="text-green-200 text-sm">
                    మీ భాష ఎంచుకోండి · ನಿಮ್ಮ ಭಾಷೆ ಆಯ್ಕೆ ಮಾಡಿ
                </p>
            </div>

            {/* Major languages */}
            <div className="w-full max-w-lg px-5 mb-6">
                <p className="text-xs font-bold uppercase tracking-widest text-green-400 mb-3">
                    {t('language.major')}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {majorLangs.map(l => (
                        <LanguageCard
                            key={l.code}
                            code={l.code}
                            native={l.name}
                            english={l.english}
                            selected={lang === l.code}
                            onPick={pick}
                        />
                    ))}
                </div>
            </div>

            {/* Other languages */}
            {otherLangs.length > 0 && (
                <div className="w-full max-w-lg px-5 mb-10">
                    <p className="text-xs font-bold uppercase tracking-widest text-green-400 mb-3">
                        {t('language.other')}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {otherLangs.map(l => (
                            <LanguageCard
                                key={l.code}
                                code={l.code}
                                native={l.name}
                                english={l.english}
                                selected={lang === l.code}
                                onPick={pick}
                                compact
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* English continue */}
            <div className="w-full max-w-lg px-5 pb-12">
                <button
                    type="button"
                    onClick={() => pick('en')}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold py-3.5 transition-all"
                >
                    <Globe className="h-4 w-4" />
                    {t('language.continueEnglish')}
                </button>
            </div>
        </div>
    );
}

// ── Language card used inside the modal ───────────────────────────────────────
function LanguageCard({
    code, native, english, selected, onPick, compact = false,
}: {
    code: LangCode; native: string; english: string;
    selected: boolean; onPick: (c: LangCode) => void; compact?: boolean;
}) {
    const { t } = useLanguage();
    const bcp47 = SUPPORTED_LOCALES.includes(code as Locale)
        ? LOCALE_META[code as Locale].speech
        : 'hi-IN';
    const phrase = CHOOSE_PHRASE[code] ?? CHOOSE_PHRASE['en']!;

    return (
        <button
            type="button"
            onClick={() => onPick(code)}
            className={cn(
                'relative flex flex-col items-center justify-center gap-1 rounded-2xl border-2 px-3 transition-all active:scale-95',
                compact ? 'py-3' : 'py-4',
                selected
                    ? 'border-yellow-400 bg-yellow-400/20 shadow-lg shadow-yellow-400/20'
                    : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10',
            )}
        >
            {selected && (
                <span className="absolute top-2 right-2 bg-yellow-400 text-green-900 rounded-full p-0.5">
                    <Check className="h-3 w-3" />
                </span>
            )}

            <span className={cn('font-bold text-white', compact ? 'text-base' : 'text-xl')}>
                {native}
            </span>
            <span className="text-xs text-green-300">{english}</span>

            {/* Voice preview — span avoids button-inside-button nesting violation */}
            <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); speak(phrase, bcp47); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); speak(phrase, bcp47); } }}
                className="mt-1 flex items-center gap-1 text-[10px] text-green-400 hover:text-yellow-300 transition-colors cursor-pointer"
                aria-label={t('language.hearLang', { lang: english })}
            >
                <Volume2 className="h-3 w-3" />
                <span>{t('language.listen')}</span>
            </span>
        </button>
    );
}

// ── Navbar dropdown ───────────────────────────────────────────────────────────
export default function LanguageSwitcher() {
    const { lang, setLang, markChosen, currentLanguage } = useLanguage();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const h = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, []);

    const pick = (code: LangCode) => {
        setLang(code);
        markChosen();
        setOpen(false);
    };

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="Select language"
            >
                <Globe className="h-4 w-4 text-gray-500" />
                <span className="hidden sm:block max-w-[72px] truncate text-sm">
                    {currentLanguage.name}
                </span>
                <ChevronDown className={cn('h-3 w-3 text-gray-400 transition-transform', open && 'rotate-180')} />
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 max-h-80 overflow-y-auto">
                    <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Language / भाषा
                    </p>
                    {LANGUAGES.map(l => (
                        <button
                            key={l.code}
                            type="button"
                            onClick={() => pick(l.code)}
                            className={cn(
                                'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-50',
                                lang === l.code && 'bg-green-50 text-green-700'
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="font-semibold truncate">{l.name}</span>
                                <span className="text-xs text-gray-400 shrink-0">{l.english}</span>
                            </div>
                            {lang === l.code && <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

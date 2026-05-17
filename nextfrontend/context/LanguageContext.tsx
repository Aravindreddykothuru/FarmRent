'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import {
    SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_META, LANG_STORAGE_KEY, LANG_SELECTED_KEY,
    type Locale,
} from '@/i18n/config';

// ── Backwards-compatible LangCode (keeps existing code working) ───────────────
export type LangCode = Locale | 'raj' | 'or';

export interface Language {
    code:    LangCode;
    name:    string;
    english: string;
    major:   boolean;
}

export const LANGUAGES: Language[] = [
    ...SUPPORTED_LOCALES.map(l => ({
        code:    l as LangCode,
        name:    LOCALE_META[l].native,
        english: LOCALE_META[l].english,
        major:   LOCALE_META[l].major,
    })),
    { code: 'raj', name: 'राजस्थानी', english: 'Rajasthani', major: false },
    { code: 'or',  name: 'ଓଡ଼ିଆ',      english: 'Odia',        major: false },
];

// ── Message loading ───────────────────────────────────────────────────────────
// Dynamic import so only the active language bundle is loaded after hydration.
const messageCache: Partial<Record<string, Record<string, any>>> = {};

async function loadMessages(locale: string): Promise<Record<string, any>> {
    const key = SUPPORTED_LOCALES.includes(locale as Locale) ? locale : DEFAULT_LOCALE;
    if (messageCache[key]) return messageCache[key]!;
    try {
        const mod = await import(`@/messages/${key}.json`);
        messageCache[key] = mod.default ?? mod;
        return messageCache[key]!;
    } catch {
        if (key !== DEFAULT_LOCALE) return loadMessages(DEFAULT_LOCALE);
        return {};
    }
}

// ── t() helpers ───────────────────────────────────────────────────────────────
function getNestedValue(obj: Record<string, any>, path: string): string | undefined {
    const val = path.split('.').reduce((acc: any, k) => acc?.[k], obj);
    return typeof val === 'string' ? val : undefined;
}

function interpolate(str: string, vars: Record<string, string | number>): string {
    return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// ── Context types ─────────────────────────────────────────────────────────────
type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface LanguageContextType {
    lang:            LangCode;
    setLang:         (code: LangCode) => void;
    t:               TFn;
    currentLanguage: Language;
    hasChosen:       boolean;          // false until user explicitly picks a language
    markChosen:      () => void;
}

const LanguageContext = createContext<LanguageContextType | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────
export function LanguageProvider({ children }: { children: ReactNode }) {
    const [lang,       setLangState] = useState<LangCode>(DEFAULT_LOCALE);
    const [messages,   setMessages]  = useState<Record<string, any>>({});
    const [fallback,   setFallback]  = useState<Record<string, any>>({});
    const [hasChosen,  setHasChosen] = useState(true); // true = don't show modal on SSR

    // Hydrate from localStorage on client
    useEffect(() => {
        const stored  = localStorage.getItem(LANG_STORAGE_KEY) as LangCode | null;
        const chosen  = localStorage.getItem(LANG_SELECTED_KEY);
        const browser = navigator.language?.split('-')[0] as LangCode | undefined;

        const resolved: LangCode =
            stored  ? stored  :
            browser && SUPPORTED_LOCALES.includes(browser as Locale) ? browser :
            DEFAULT_LOCALE;

        setLangState(resolved);
        setHasChosen(!!chosen);

        // Load English fallback once
        loadMessages(DEFAULT_LOCALE).then(setFallback);
    }, []);

    // Reload messages whenever lang changes
    useEffect(() => {
        loadMessages(lang).then(setMessages);
    }, [lang]);

    const setLang = (code: LangCode) => {
        setLangState(code);
        localStorage.setItem(LANG_STORAGE_KEY, code);
    };

    const markChosen = () => {
        setHasChosen(true);
        localStorage.setItem(LANG_SELECTED_KEY, '1');
    };

    const t: TFn = (key, vars = {}) => {
        const val = getNestedValue(messages, key) ?? getNestedValue(fallback, key) ?? key;
        return interpolate(val, vars);
    };

    const currentLanguage = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];

    return (
        <LanguageContext.Provider value={{ lang, setLang, t, currentLanguage, hasChosen, markChosen }}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const ctx = useContext(LanguageContext);
    if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
    return ctx;
}

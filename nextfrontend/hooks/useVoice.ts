'use client';

import { useCallback, useRef } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const SPEECH_LOCALE: Record<string, string> = {
    en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', te: 'te-IN',
    ta: 'ta-IN', mr: 'mr-IN', pa: 'pa-IN', bn: 'bn-IN',
    gu: 'gu-IN', ml: 'ml-IN', raj: 'hi-IN', or: 'or-IN',
};

export function useVoice() {
    const { lang } = useLanguage();
    const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

    const speak = useCallback((text: string, overrideLang?: string) => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

        window.speechSynthesis.cancel();

        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = SPEECH_LOCALE[overrideLang ?? lang] ?? 'en-IN';
        utter.rate = 0.9;
        utter.pitch = 1;

        // Try to find a matching voice
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find(v => v.lang.startsWith(utter.lang.split('-')[0]));
        if (match) utter.voice = match;

        utterRef.current = utter;
        window.speechSynthesis.speak(utter);
    }, [lang]);

    const stop = useCallback(() => {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }, []);

    const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

    return { speak, stop, isSupported };
}

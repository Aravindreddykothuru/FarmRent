export const SUPPORTED_LOCALES = [
    'en', 'hi', 'kn', 'te', 'ta', 'mr', 'pa', 'bn', 'gu', 'ml',
] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'en';

export interface LocaleMeta {
    native:  string;
    english: string;
    speech:  string;   // BCP 47 tag for Web Speech API
    major:   boolean;
}

export const LOCALE_META: Record<Locale, LocaleMeta> = {
    en: { native: 'English',    english: 'English',   speech: 'en-IN', major: false },
    hi: { native: 'हिन्दी',     english: 'Hindi',     speech: 'hi-IN', major: true  },
    kn: { native: 'ಕನ್ನಡ',      english: 'Kannada',   speech: 'kn-IN', major: true  },
    te: { native: 'తెలుగు',     english: 'Telugu',    speech: 'te-IN', major: true  },
    ta: { native: 'தமிழ்',      english: 'Tamil',     speech: 'ta-IN', major: true  },
    mr: { native: 'मराठी',      english: 'Marathi',   speech: 'mr-IN', major: true  },
    pa: { native: 'ਪੰਜਾਬੀ',     english: 'Punjabi',   speech: 'pa-IN', major: false },
    bn: { native: 'বাংলা',      english: 'Bengali',   speech: 'bn-IN', major: false },
    gu: { native: 'ગુજરાતી',   english: 'Gujarati',  speech: 'gu-IN', major: false },
    ml: { native: 'മലയാളം',    english: 'Malayalam', speech: 'ml-IN', major: true  },
};

export const MAJOR_LOCALES = SUPPORTED_LOCALES.filter(l => LOCALE_META[l].major);
export const OTHER_LOCALES  = SUPPORTED_LOCALES.filter(l => !LOCALE_META[l].major);

// localStorage key
export const LANG_STORAGE_KEY    = 'farmrent_lang';
export const LANG_SELECTED_KEY   = 'farmrent_lang_chosen'; // set once user picks a language

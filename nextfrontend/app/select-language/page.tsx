'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Tractor, Check, Globe } from 'lucide-react';
import Link from 'next/link';
import { LANGUAGES, useLanguage, type LangCode } from '@/context/LanguageContext';

const MAJOR = LANGUAGES.filter(l => l.major);
const OTHER = LANGUAGES.filter(l => !l.major && l.code !== 'en');

function SelectLanguagePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { lang, setLang, t } = useLanguage();

    const next = searchParams.get('next') ?? '/login';

    const pick = (code: LangCode) => {
        setLang(code);
        router.push(next);
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-green-50 to-white px-4 py-12">

            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 mb-10">
                <div className="bg-green-700 rounded-xl p-2.5 shadow-md">
                    <Tractor className="h-7 w-7 text-white" />
                </div>
                <span className="text-3xl font-black text-green-700">FarmRent</span>
            </Link>

            {/* Heading */}
            <div className="text-center mb-8">
                <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-4">
                    <Globe className="h-4 w-4" />
                    {t('language.select')}
                </div>
                <h1 className="text-2xl font-black text-gray-900 mb-1">{t('language.choose')}</h1>
                <p className="text-sm text-gray-500">{t('language.choose')}</p>
            </div>

            {/* Major languages */}
            <div className="w-full max-w-lg mb-6">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('language.major')}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {MAJOR.map(l => (
                        <button
                            key={l.code}
                            type="button"
                            onClick={() => pick(l.code)}
                            className={`relative flex flex-col items-center gap-1.5 rounded-2xl border-2 px-4 py-4 transition-all hover:shadow-md active:scale-95
                                ${lang === l.code
                                    ? 'border-green-600 bg-green-50 shadow-md'
                                    : 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50/50'}`}
                        >
                            {lang === l.code && (
                                <span className="absolute top-2 right-2 bg-green-600 text-white rounded-full p-0.5">
                                    <Check className="h-3 w-3" />
                                </span>
                            )}
                            <span className="text-2xl font-bold text-gray-800">{l.name}</span>
                            <span className="text-xs text-gray-500">{l.english}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Other languages */}
            <div className="w-full max-w-lg mb-8">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('language.other')}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {OTHER.map(l => (
                        <button
                            key={l.code}
                            type="button"
                            onClick={() => pick(l.code)}
                            className={`relative flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 transition-all hover:shadow-sm active:scale-95
                                ${lang === l.code
                                    ? 'border-green-600 bg-green-50 shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-green-300 hover:bg-green-50/50'}`}
                        >
                            {lang === l.code && (
                                <span className="absolute top-1.5 right-1.5 bg-green-600 text-white rounded-full p-0.5">
                                    <Check className="h-2.5 w-2.5" />
                                </span>
                            )}
                            <span className="text-lg font-bold text-gray-800">{l.name}</span>
                            <span className="text-xs text-gray-400">{l.english}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* English / skip */}
            <div className="flex flex-col items-center gap-3 w-full max-w-lg">
                <button
                    type="button"
                    onClick={() => pick('en')}
                    className={`w-full flex items-center justify-center gap-2 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all
                        ${lang === 'en'
                            ? 'border-green-600 bg-green-50 text-green-700'
                            : 'border-gray-200 bg-white text-gray-600 hover:border-green-300 hover:bg-green-50/50'}`}
                >
                    <Globe className="h-4 w-4" />
                    {lang === 'en' && <Check className="h-4 w-4 text-green-600" />}
                    {t('language.continueEnglish')}
                </button>
            </div>
        </div>
    );
}

export default function Page() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-700" />
            </div>
        }>
            <SelectLanguagePage />
        </Suspense>
    );
}

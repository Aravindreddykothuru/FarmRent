'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/context/LanguageContext';
import {
    Search, Calendar, Truck, CheckCircle,
    Users, Shield, DollarSign, MessageSquare,
    FileText, Wrench, ArrowRight, Zap,
} from 'lucide-react';

type Step = { icon: React.ElementType; title: string; desc: string };
type SafeTip = Step & { color: string };

function StepGrid({ steps }: { steps: Step[] }) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {steps.map((step, i) => (
                <div key={step.title} className="relative group">
                    {i < steps.length - 1 && (
                        <div className="hidden lg:block absolute top-7 left-[calc(100%+4px)] w-[calc(100%-8px)] h-px bg-gradient-to-r from-green-200 to-green-100 z-0" />
                    )}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md hover:border-green-200 hover:-translate-y-0.5 transition-all duration-200 relative z-10 h-full flex flex-col">
                        <div className="absolute -top-3 left-5">
                            <span className="bg-green-700 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow">
                                {i + 1}
                            </span>
                        </div>
                        <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center mb-4 mt-2 group-hover:bg-green-100 transition-colors">
                            <step.icon className="h-5 w-5 text-green-700" />
                        </div>
                        <p className="font-bold text-gray-900 text-sm mb-1.5">{step.title}</p>
                        <p className="text-xs text-gray-500 leading-relaxed flex-1">{step.desc}</p>
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function HowItWorksPage() {
    const { t } = useLanguage();

    const FOR_RENTERS: Step[] = [
        { icon: Users,         title: t('howItWorks.r1Title'), desc: t('howItWorks.r1Desc') },
        { icon: Search,        title: t('howItWorks.r2Title'), desc: t('howItWorks.r2Desc') },
        { icon: FileText,      title: t('howItWorks.r3Title'), desc: t('howItWorks.r3Desc') },
        { icon: Calendar,      title: t('howItWorks.r4Title'), desc: t('howItWorks.r4Desc') },
        { icon: DollarSign,    title: t('howItWorks.r5Title'), desc: t('howItWorks.r5Desc') },
        { icon: Truck,         title: t('howItWorks.r6Title'), desc: t('howItWorks.r6Desc') },
        { icon: Wrench,        title: t('howItWorks.r7Title'), desc: t('howItWorks.r7Desc') },
        { icon: CheckCircle,   title: t('howItWorks.r8Title'), desc: t('howItWorks.r8Desc') },
    ];

    const FOR_OWNERS: Step[] = [
        { icon: Users,          title: t('howItWorks.o1Title'), desc: t('howItWorks.o1Desc') },
        { icon: FileText,       title: t('howItWorks.o2Title'), desc: t('howItWorks.o2Desc') },
        { icon: MessageSquare,  title: t('howItWorks.o3Title'), desc: t('howItWorks.o3Desc') },
        { icon: CheckCircle,    title: t('howItWorks.o4Title'), desc: t('howItWorks.o4Desc') },
        { icon: Wrench,         title: t('howItWorks.o5Title'), desc: t('howItWorks.o5Desc') },
        { icon: Truck,          title: t('howItWorks.o6Title'), desc: t('howItWorks.o6Desc') },
        { icon: DollarSign,     title: t('howItWorks.o7Title'), desc: t('howItWorks.o7Desc') },
        { icon: CheckCircle,    title: t('howItWorks.o8Title'), desc: t('howItWorks.o8Desc') },
    ];

    const SAFETY_TIPS: SafeTip[] = [
        { icon: Shield,        title: t('howItWorks.s1Title'), desc: t('howItWorks.s1Desc'), color: 'bg-blue-50 text-blue-600' },
        { icon: FileText,      title: t('howItWorks.s2Title'), desc: t('howItWorks.s2Desc'), color: 'bg-purple-50 text-purple-600' },
        { icon: MessageSquare, title: t('howItWorks.s3Title'), desc: t('howItWorks.s3Desc'), color: 'bg-amber-50 text-amber-600' },
        { icon: Wrench,        title: t('howItWorks.s4Title'), desc: t('howItWorks.s4Desc'), color: 'bg-green-50 text-green-600' },
    ];

    const STATS = [
        { v: '2 min', l: t('howItWorks.statsBookingTime') },
        { v: '500+',  l: t('howItWorks.statsVerified') },
        { v: '15',    l: t('howItWorks.statesCovered') },
        { v: '4.8★',  l: t('howItWorks.statsRating') },
    ];

    return (
        <div className="bg-[#F7F8FA]">

            {/* ── Hero ── */}
            <section className="relative bg-gradient-to-br from-green-950 via-green-900 to-green-800 py-16 lg:py-24 overflow-hidden">
                <div className="absolute inset-0 opacity-[0.07] hero-pattern" />
                <div className="absolute top-0 right-0 w-80 h-80 bg-yellow-400/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                <div className="container mx-auto px-4 lg:px-8 text-center relative z-10">
                    <Badge className="bg-yellow-400/20 text-yellow-300 border-0 mb-4 text-xs font-bold">{t('howItWorks.badge')}</Badge>
                    <h1 className="text-4xl md:text-5xl font-black text-white mb-4">{t('home.howItWorks')}</h1>
                    <p className="text-green-200 text-lg max-w-2xl mx-auto">
                        {t('home.howItWorksSubtitle')}
                    </p>
                    <div className="flex flex-wrap justify-center gap-3 mt-7">
                        <a href="#renters" className="bg-white text-green-800 font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-green-50 transition-colors">
                            {t('home.forFarmers')} →
                        </a>
                        <a href="#owners" className="bg-white/10 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-white/20 transition-colors border border-white/20">
                            {t('home.forOwners')} →
                        </a>
                    </div>
                </div>
            </section>

            {/* ── Stats strip ── */}
            <div className="bg-white border-b border-gray-100">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100">
                        {STATS.map(s => (
                            <div key={s.l} className="py-5 px-4 text-center">
                                <p className="text-2xl font-black text-green-700">{s.v}</p>
                                <p className="text-xs text-gray-500 mt-0.5">{s.l}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── For Renters ── */}
            <section id="renters" className="py-14 lg:py-20">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center text-2xl">👨‍🌾</div>
                        <div>
                            <Badge className="bg-green-100 text-green-700 border-0 mb-1 text-[10px]">{t('howItWorks.forRentersBadge')}</Badge>
                            <h2 className="text-2xl font-black text-gray-900">{t('howItWorks.rentingEquipment')}</h2>
                            <p className="text-gray-500 text-sm">{t('howItWorks.renterStepsDesc')}</p>
                        </div>
                    </div>
                    <StepGrid steps={FOR_RENTERS} />
                </div>
            </section>

            {/* ── For Owners ── */}
            <section id="owners" className="py-14 lg:py-20 bg-white">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center text-2xl">🚜</div>
                        <div>
                            <Badge className="bg-amber-100 text-amber-700 border-0 mb-1 text-[10px]">{t('howItWorks.forOwnersBadge')}</Badge>
                            <h2 className="text-2xl font-black text-gray-900">{t('howItWorks.listingEquipment')}</h2>
                            <p className="text-gray-500 text-sm">{t('howItWorks.ownerStepsDesc')}</p>
                        </div>
                    </div>
                    <StepGrid steps={FOR_OWNERS} />
                </div>
            </section>

            {/* ── Safety & Best Practices ── */}
            <section className="py-14 lg:py-20">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="text-center mb-10">
                        <Badge className="bg-blue-100 text-blue-700 border-0 mb-3 text-[10px]">{t('howItWorks.safetyBadge')}</Badge>
                        <h2 className="text-2xl font-black text-gray-900">{t('howItWorks.safetyTitle')}</h2>
                        <p className="text-gray-500 text-sm mt-1">{t('howItWorks.safetyDesc')}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                        {SAFETY_TIPS.map(tip => (
                            <div key={tip.title} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${tip.color}`}>
                                    <tip.icon className="h-5 w-5" />
                                </div>
                                <h3 className="font-bold text-gray-900 mb-2">{tip.title}</h3>
                                <p className="text-sm text-gray-500 leading-relaxed">{tip.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── AI feature callout ── */}
            <section className="py-6">
                <div className="container mx-auto px-4 lg:px-8">
                    <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-3xl p-7 lg:p-10 flex flex-col sm:flex-row items-center justify-between gap-5 text-white shadow-lg">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                                <Zap className="h-7 w-7 text-white" />
                            </div>
                            <div>
                                <p className="font-black text-xl">{t('howItWorks.aiTitle')}</p>
                                <p className="text-indigo-200 text-sm mt-0.5">{t('howItWorks.aiDesc')}</p>
                            </div>
                        </div>
                        <Link href="/ai-assistant" className="flex-shrink-0">
                            <Button className="bg-white text-indigo-700 hover:bg-indigo-50 font-bold rounded-xl px-6">
                                {t('howItWorks.askAI')} <ArrowRight className="h-4 w-4 ml-1" />
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* ── Bottom CTA ── */}
            <section className="py-16 lg:py-20 bg-gradient-to-br from-green-900 to-green-800">
                <div className="container mx-auto px-4 lg:px-8 text-center">
                    <h2 className="text-3xl font-black text-white mb-3">{t('footer.cta')}</h2>
                    <p className="text-green-200 mb-8 max-w-xl mx-auto text-base">
                        {t('footer.ctaSub')}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/browse">
                            <Button size="lg" className="bg-white text-green-800 hover:bg-green-50 font-bold rounded-xl w-full sm:w-auto px-8">
                                {t('home.browseEquipment')}
                            </Button>
                        </Link>
                        <Link href="/register">
                            <Button size="lg" className="bg-yellow-400 text-yellow-950 hover:bg-yellow-300 font-bold rounded-xl w-full sm:w-auto px-8">
                                {t('footer.getStarted')}
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>
        </div>
    );
}

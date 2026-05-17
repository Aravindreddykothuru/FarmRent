'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { AIChat } from '@/components/AIChat';
import { AIEquipmentRecommendation } from '@/components/AIEquipmentRecommendation';
import { AIFarmingInsights } from '@/components/AIFarmingInsights';
import { Bot, Tractor, TrendingUp, MessageSquare } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function AIAssistantPage() {
  const { t } = useLanguage();

  const FEATURES = [
    { icon: MessageSquare, color: 'text-blue-600',   title: t('ai.conversationalSupport'),  desc: t('ai.conversationalSupportDesc') },
    { icon: Tractor,       color: 'text-green-600',  title: t('ai.smartRecommendations'),   desc: t('ai.smartRecommendationsDesc') },
    { icon: TrendingUp,    color: 'text-purple-600', title: t('ai.farmingInsightsFeature'), desc: t('ai.farmingInsightsDesc') },
  ];

  const BENEFITS = [
    { title: t('ai.benefit1Title'), desc: t('ai.benefit1Desc') },
    { title: t('ai.benefit2Title'), desc: t('ai.benefit2Desc') },
    { title: t('ai.benefit3Title'), desc: t('ai.benefit3Desc') },
    { title: t('ai.benefit4Title'), desc: t('ai.benefit4Desc') },
  ];

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Bot className="h-8 w-8 text-green-600" />
            <h1 className="text-3xl font-bold text-gray-900">{t('nav.aiAssistant')}</h1>
          </div>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            {t('home.aiDesc')}
          </p>
        </div>

        {/* Features Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {FEATURES.map(f => (
            <Card key={f.title}>
              <CardContent className="p-6 text-center">
                <f.icon className={`h-12 w-12 ${f.color} mx-auto mb-4`} />
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-gray-600 text-sm">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* AI Tools Tabs */}
        <Tabs defaultValue="chat" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              {t('ai.chatTab')}
            </TabsTrigger>
            <TabsTrigger value="equipment" className="flex items-center gap-2">
              <Tractor className="h-4 w-4" />
              {t('ai.equipmentTab')}
            </TabsTrigger>
            <TabsTrigger value="insights" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('ai.insightsTab')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="mt-6">
            <div className="max-w-4xl mx-auto">
              <AIChat
                context="general_farming"
                placeholder={t('ai.generalPlaceholder')}
              />
            </div>
          </TabsContent>

          <TabsContent value="equipment" className="mt-6">
            <div className="max-w-4xl mx-auto">
              <AIEquipmentRecommendation />
            </div>
          </TabsContent>

          <TabsContent value="insights" className="mt-6">
            <div className="max-w-4xl mx-auto">
              <AIFarmingInsights />
            </div>
          </TabsContent>
        </Tabs>

        {/* Benefits Section */}
        <div className="mt-12 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-center mb-6">{t('ai.whyChoose')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {BENEFITS.map(b => (
              <div key={b.title} className="space-y-3">
                <h3 className="font-semibold text-green-800">{b.title}</h3>
                <p className="text-sm text-gray-700">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

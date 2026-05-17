'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, TrendingUp, Lightbulb, Target, Calendar } from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { useLanguage } from '@/context/LanguageContext';

interface FarmingInsight {
    insights: string;
    generated_at: string;
    data_points_analyzed: number;
}

interface BookingRecord {
    id: string;
    start_date: string;
    end_date: string;
    total_amount: number;
    status: string;
    equipment?: { name: string; type: string };
}

export function AIFarmingInsights() {
    const { t } = useLanguage();
    const [isLoading, setIsLoading]       = useState(false);
    const [insights, setInsights]         = useState<FarmingInsight | null>(null);
    const [error, setError]               = useState('');
    const [bookings, setBookings]         = useState<BookingRecord[]>([]);
    const [loadingHistory, setLH]         = useState(true);

    useEffect(() => {
        nodeApi.get<any>('/bookings/my')
            .then(r => setBookings(r?.bookings ?? r?.data?.bookings ?? []))
            .catch(() => {})
            .finally(() => setLH(false));
    }, []);

    const completed = bookings.filter(b => ['completed', 'returned'].includes(b.status));
    const totalSpent = completed.reduce((s, b) => s + Number(b.total_amount), 0);
    const typeCount: Record<string, number> = {};
    completed.forEach(b => {
        const t = b.equipment?.type?.replace(/-/g, ' ') ?? 'other';
        typeCount[t] = (typeCount[t] ?? 0) + 1;
    });
    const topType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0];

    const generateInsights = async () => {
        setIsLoading(true);
        setError('');
        setInsights(null);

        const userHistory = completed.map(b => ({
            date:      b.start_date,
            equipment: b.equipment?.name ?? 'Unknown',
            type:      b.equipment?.type ?? 'other',
            duration:  Math.max(1, Math.round((new Date(b.end_date).getTime() - new Date(b.start_date).getTime()) / 86400000)),
            cost:      Number(b.total_amount),
        }));

        try {
            const response = await fetch('/api/v2/llm/insights/generate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ user_history: userHistory }),
            });

            if (response.ok) {
                setInsights(await response.json());
            } else {
                throw new Error('Failed to generate insights');
            }
        } catch {
            setError(t('ai.insightsError'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-yellow-600" />
                        {t('ai.insightsTitle')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-4 rounded-lg">
                            <h3 className="font-medium text-blue-800 mb-2">{t('ai.rentalActivity')}</h3>
                            {loadingHistory ? (
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-2/3" />
                                    <Skeleton className="h-4 w-1/2" />
                                    <Skeleton className="h-4 w-3/4" />
                                </div>
                            ) : completed.length === 0 ? (
                                <p className="text-sm text-blue-600">{t('ai.noRentals')}</p>
                            ) : (
                                <div className="space-y-2 text-sm text-blue-700">
                                    <div className="flex justify-between">
                                        <span>{t('ai.totalRentals')}</span>
                                        <span className="font-medium">{completed.length}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>{t('ai.totalSpent')}</span>
                                        <span className="font-medium">₹{totalSpent.toLocaleString('en-IN')}</span>
                                    </div>
                                    {topType && (
                                        <div className="flex justify-between">
                                            <span>{t('ai.mostRented')}</span>
                                            <span className="font-medium capitalize">{topType}</span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <Button
                            onClick={generateInsights}
                            disabled={isLoading || completed.length === 0}
                            className="w-full"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    {t('ai.generatingInsights')}
                                </>
                            ) : (
                                <>
                                    <TrendingUp className="mr-2 h-4 w-4" />
                                    {t('ai.generateInsights')}
                                </>
                            )}
                        </Button>

                        {completed.length === 0 && !loadingHistory && (
                            <p className="text-xs text-gray-400 text-center">{t('ai.completeRental')}</p>
                        )}

                        {error && (
                            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">{error}</div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {insights && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-purple-700">
                            <Target className="h-5 w-5" />
                            {t('ai.yourInsights')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                            <Badge variant="outline">
                                <Calendar className="h-3 w-3 mr-1" />
                                {t('ai.generated', { date: new Date(insights.generated_at).toLocaleDateString('en-IN') })}
                            </Badge>
                            <Badge variant="outline">
                                {t('ai.analyzed', { count: String(insights.data_points_analyzed) })}
                            </Badge>
                        </div>

                        <div className="bg-purple-50 p-4 rounded-lg">
                            <div className="prose prose-sm max-w-none text-purple-800">
                                {insights.insights.split('\n').map((paragraph, index) => (
                                    <p key={index} className="mb-3 last:mb-0">{paragraph}</p>
                                ))}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

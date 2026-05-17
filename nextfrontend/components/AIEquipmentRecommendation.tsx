'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Tractor, Clock, IndianRupee, Shield } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface EquipmentRecommendation {
  equipment: string;
  reasoning: string;
  duration: string;
  estimated_cost: string;
  safety_notes: string;
  alternatives: string[];
}

export function AIEquipmentRecommendation() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [farmSize, setFarmSize] = useState('');
  const [soilType, setSoilType] = useState('');
  const [crop, setCrop] = useState('');
  const [season, setSeason] = useState('');
  const [budget, setBudget] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<EquipmentRecommendation | null>(null);
  const [error, setError] = useState('');

  const getRecommendation = async () => {
    if (!query.trim()) {
      setError(t('ai.pleaseDescribe'));
      return;
    }

    setIsLoading(true);
    setError('');
    setRecommendation(null);

    try {
      const context: any = {};
      if (farmSize) context.farm_size = farmSize;
      if (soilType) context.soil_type = soilType;
      if (crop) context.crop = crop;
      if (season) context.season = season;
      if (budget) context.budget = budget;

      const response = await fetch('/api/v2/llm/equipment/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query,
          context: context
        })
      });

      if (response.ok) {
        const data = await response.json();
        setRecommendation(data);
      } else {
        throw new Error('Failed to get recommendation');
      }
    } catch (error) {
      void error;
      setError(t('ai.recommendationError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tractor className="h-5 w-5 text-green-600" />
            {t('ai.recommendTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="query">{t('ai.whatToDo')}</Label>
            <Textarea
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ai.whatToDoPlaceholder')}
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="farmSize">{t('ai.farmSize')}</Label>
              <Select value={farmSize} onValueChange={setFarmSize}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ai.farmSizePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">{t('ai.farmSmall')}</SelectItem>
                  <SelectItem value="medium">{t('ai.farmMedium')}</SelectItem>
                  <SelectItem value="large">{t('ai.farmLarge')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="soilType">{t('ai.soilType')}</Label>
              <Select value={soilType} onValueChange={setSoilType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ai.soilTypePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clay">{t('ai.clay')}</SelectItem>
                  <SelectItem value="sandy">{t('ai.sandy')}</SelectItem>
                  <SelectItem value="loamy">{t('ai.loamy')}</SelectItem>
                  <SelectItem value="silt">{t('ai.silt')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="crop">{t('ai.cropType')}</Label>
              <Select value={crop} onValueChange={setCrop}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ai.cropPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wheat">{t('ai.wheat')}</SelectItem>
                  <SelectItem value="rice">{t('ai.rice')}</SelectItem>
                  <SelectItem value="corn">{t('ai.corn')}</SelectItem>
                  <SelectItem value="soybeans">{t('ai.soybeans')}</SelectItem>
                  <SelectItem value="cotton">{t('ai.cotton')}</SelectItem>
                  <SelectItem value="other">{t('ai.other')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="season">{t('ai.season')}</Label>
              <Select value={season} onValueChange={setSeason}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ai.seasonPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spring">{t('ai.spring')}</SelectItem>
                  <SelectItem value="summer">{t('ai.summer')}</SelectItem>
                  <SelectItem value="fall">{t('ai.fall')}</SelectItem>
                  <SelectItem value="winter">{t('ai.winter')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="budget">{t('ai.budget')}</Label>
              <Select value={budget} onValueChange={setBudget}>
                <SelectTrigger>
                  <SelectValue placeholder={t('ai.budgetPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('ai.budgetLow')}</SelectItem>
                  <SelectItem value="moderate">{t('ai.budgetModerate')}</SelectItem>
                  <SelectItem value="high">{t('ai.budgetHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={getRecommendation}
            disabled={isLoading || !query.trim()}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('ai.gettingRecommendation')}
              </>
            ) : (
              t('ai.getRecommendation')
            )}
          </Button>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {recommendation && (
        <Card>
          <CardHeader>
            <CardTitle className="text-green-700">{t('ai.recommendationResult')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-lg text-green-800 mb-2">
                {recommendation.equipment}
              </h3>
              <p className="text-green-700">{recommendation.reasoning}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg">
                <Clock className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-800">{t('ai.duration')}</p>
                  <p className="text-sm text-blue-600">{recommendation.duration}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg">
                <IndianRupee className="h-5 w-5 text-green-600" />
                <div>
                  <p className="font-medium text-green-800">{t('ai.estimatedCost')}</p>
                  <p className="text-sm text-green-600">{recommendation.estimated_cost}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-orange-50 rounded-lg">
                <Shield className="h-5 w-5 text-orange-600" />
                <div>
                  <p className="font-medium text-orange-800">{t('ai.safetyNotes')}</p>
                  <p className="text-sm text-orange-600">{recommendation.safety_notes}</p>
                </div>
              </div>
            </div>

            {recommendation.alternatives && recommendation.alternatives.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">{t('ai.alternatives')}</h4>
                <div className="flex flex-wrap gap-2">
                  {recommendation.alternatives.map((alt, index) => (
                    <Badge key={index} variant="outline">
                      {alt}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
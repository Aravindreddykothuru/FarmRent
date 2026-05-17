'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Pencil, ChevronLeft, X } from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';
import ImageUploader from '@/components/ImageUploader';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
    ssr: false,
    loading: () => <div className="h-60 bg-gray-100 rounded-xl animate-pulse" />,
});

const CATEGORY_GROUPS = [
    { group: 'Land Preparation', types: ['moldboard-plough', 'disc-plough', 'chisel-plough', 'subsoiler', 'disc-harrow', 'chain-harrow', 'spring-tooth-harrow', 'land-leveler'] },
    { group: 'Soil Cultivation', types: ['cultivator', 'rotavator', 'power-tiller'] },
    { group: 'Planting Equipment', types: ['seed-drill', 'planter', 'rice-transplanter', 'broadcast-seeder'] },
    { group: 'Crop Care', types: ['boom-sprayer', 'air-assisted-sprayer', 'knapsack-sprayer', 'fertilizer-spreader', 'weed-remover'] },
    { group: 'Harvesting Equipment', types: ['reaper', 'combine-harvester', 'thresher'] },
    { group: 'Transport & Support', types: ['tractor', 'tractor-trailer', 'water-pump', 'baler', 'straw-reaper'] },
];

interface LocationResult { lat: number; lng: number; address: string }

export default function EditEquipmentPage() {
    const { id } = useParams<{ id: string }>();
    const router = useRouter();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [location, setLocation] = useState<LocationResult | null>(null);
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [form, setForm] = useState({
        name: '',
        type: 'tractor',
        description: '',
        pricePerDay: '',
        pricePerHour: '',
        securityDeposit: '',
        operatorIncluded: false,
        village: '',
        district: '',
        state: 'Telangana',
        status: 'available',
        features: '',
        serviceRadiusKm: '50',
        servicePincodes: '',
        specKey: '', specValue: '',
    });
    const [specs, setSpecs] = useState<Record<string, string>>({});
    const [existingLocation, setExistingLocation] = useState<{ coordinates?: [number, number]; village?: string; district?: string; state?: string } | null>(null);

    const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

    useEffect(() => {
        if (!id) return;
        nodeApi.get<any>(`/machines/${id}`)
            .then((r) => {
                const m = r?.data ?? r;
                if (!m) return;
                setForm({
                    name: m.name ?? '',
                    type: m.type ?? 'tractor',
                    description: m.description ?? '',
                    pricePerDay: String(m.pricing?.baseRatePerDay ?? ''),
                    pricePerHour: String(m.pricing?.baseRatePerHour ?? ''),
                    securityDeposit: String(m.pricing?.securityDeposit ?? ''),
                    operatorIncluded: !!m.pricing?.operatorIncluded,
                    village: m.location?.village ?? '',
                    district: m.location?.district ?? '',
                    state: m.location?.state ?? 'Telangana',
                    status: m.status ?? 'available',
                    features: Array.isArray(m.features) ? m.features.join(', ') : '',
                    serviceRadiusKm: String(m.service_radius_km ?? '50'),
                    servicePincodes: Array.isArray(m.service_pincodes) ? m.service_pincodes.join(', ') : '',
                    specKey: '', specValue: '',
                });
                setImageUrls(m.images?.length ? m.images : []);
                setSpecs(typeof m.specifications === 'object' && m.specifications ? m.specifications : {});
                setExistingLocation(m.location ?? null);
                const coords = m.location?.coordinates?.coordinates ?? m.location?.coordinates;
                if (Array.isArray(coords) && coords.length >= 2) {
                    setLocation({ lat: coords[1], lng: coords[0], address: [m.location?.district, m.location?.state].filter(Boolean).join(', ') });
                }
            })
            .catch(() => toast.error(t('editEquipment.couldNotLoad')))
            .finally(() => setLoading(false));
    }, [id]);

    const addSpec = () => {
        if (!form.specKey.trim()) return;
        setSpecs(p => ({ ...p, [form.specKey.trim()]: form.specValue.trim() }));
        setForm(p => ({ ...p, specKey: '', specValue: '' }));
    };

    const removeSpec = (k: string) => setSpecs(p => { const n = { ...p }; delete n[k]; return n; });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!id) return;
        if (!form.name || !form.pricePerDay) return toast.error(t('editEquipment.nameRequired'));

        setSubmitting(true);
        try {
            const features = form.features.split(',').map(f => f.trim()).filter(Boolean);
            const payload: any = {
                name: form.name,
                type: form.type,
                description: form.description,
                status: form.status,
                pricing: {
                    baseRatePerDay: Number(form.pricePerDay),
                    baseRatePerHour: form.pricePerHour ? Number(form.pricePerHour) : undefined,
                    securityDeposit: form.securityDeposit ? Number(form.securityDeposit) : 0,
                    operatorIncluded: form.operatorIncluded,
                },
                location: {
                    village: form.village,
                    district: form.district,
                    state: form.state,
                    ...(location
                        ? { coordinates: { type: 'Point' as const, coordinates: [location.lng, location.lat] } }
                        : existingLocation?.coordinates ? { coordinates: { type: 'Point' as const, coordinates: existingLocation.coordinates } } : {}),
                },
                service_radius_km: Number(form.serviceRadiusKm) || 50,
                service_pincodes: form.servicePincodes.split(',').map(p => p.trim()).filter(p => /^\d{6}$/.test(p)),
                images: imageUrls.filter(u => u.trim()),
                features,
                specifications: specs,
            };
            await nodeApi.patch<any>(`/machines/${id}`, payload);
            toast.success(t('editEquipment.updated'));
            router.push('/dashboard/owner');
        } catch (e: any) {
            toast.error(e.message || t('editEquipment.failedUpdate'));
        } finally { setSubmitting(false); }
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-green-700" />
        </div>
    );

    return (
        <div className="py-8 min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 max-w-2xl">
                <div className="mb-8 flex items-center gap-4">
                    <Link href="/dashboard/owner" className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline">
                        <ChevronLeft className="h-4 w-4" /> {t('editEquipment.backToDashboard')}
                    </Link>
                </div>
                <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-1 flex items-center gap-2"><Pencil className="h-8 w-8" /> {t('editEquipment.title')}</h1>
                    <p className="text-gray-500">{t('editEquipment.subtitle')}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.basicInfo')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="mb-1.5 block">{t('editEquipment.equipmentName')} *</Label>
                                <Input placeholder="e.g. Mahindra 475 DI Tractor" value={form.name} onChange={e => set('name', e.target.value)} required />
                            </div>
                            <div>
                                <Label className="mb-1.5 block">{t('editEquipment.equipmentType')} *</Label>
                                <select value={form.type} onChange={e => set('type', e.target.value)} aria-label="Equipment type" suppressHydrationWarning
                                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white">
                                    {CATEGORY_GROUPS.map(g => (
                                        <optgroup key={g.group} label={g.group}>
                                            {g.types.map(t => <option key={t} value={t}>{t.replace(/-/g, ' ')}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <Label className="mb-1.5 block">{t('editEquipment.status')}</Label>
                                <select value={form.status} onChange={e => set('status', e.target.value)} aria-label="Availability status" suppressHydrationWarning
                                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white">
                                    <option value="available">{t('editEquipment.available')}</option>
                                    <option value="unavailable">{t('editEquipment.unavailable')}</option>
                                </select>
                            </div>
                            <div>
                                <Label className="mb-1.5 block">{t('editEquipment.description')}</Label>
                                <textarea suppressHydrationWarning placeholder="Describe your equipment…" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-green-600"
                                    value={form.description} onChange={e => set('description', e.target.value)} />
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.pricing')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="mb-1.5 block">{t('editEquipment.ratePerDay')} *</Label>
                                    <Input type="number" placeholder="e.g. 2500" min="0" value={form.pricePerDay} onChange={e => set('pricePerDay', e.target.value)} required />
                                </div>
                                <div>
                                    <Label className="mb-1.5 block">{t('editEquipment.ratePerHour')}</Label>
                                    <Input type="number" placeholder="Optional" min="0" value={form.pricePerHour} onChange={e => set('pricePerHour', e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label className="mb-1.5 block">{t('editEquipment.securityDeposit')}</Label>
                                    <Input type="number" placeholder="Optional" min="0" value={form.securityDeposit} onChange={e => set('securityDeposit', e.target.value)} />
                                </div>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" suppressHydrationWarning className="w-4 h-4 accent-green-700" checked={form.operatorIncluded} onChange={e => set('operatorIncluded', e.target.checked)} />
                                        <span className="text-sm font-medium">{t('editEquipment.operatorIncluded')}</span>
                                    </label>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.location')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-xs text-gray-500">{t('editEquipment.locationHint')}</p>
                            <LocationPicker onLocationChange={r => {
                                setLocation(r);
                                setForm(p => ({
                                    ...p,
                                    village:  r.parts.village  || p.village,
                                    district: r.parts.district || p.district,
                                    state:    r.parts.state    || p.state,
                                }));
                            }} />
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <Label className="mb-1.5 block text-xs">{t('editEquipment.village')}</Label>
                                    <Input placeholder="Optional" className="text-sm" value={form.village} onChange={e => set('village', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="mb-1.5 block text-xs">{t('editEquipment.district')}</Label>
                                    <Input placeholder="e.g. Nalgonda" className="text-sm" value={form.district} onChange={e => set('district', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="mb-1.5 block text-xs">{t('editEquipment.state')}</Label>
                                    <Input placeholder="e.g. Telangana" className="text-sm" value={form.state} onChange={e => set('state', e.target.value)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.serviceArea')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-xs text-gray-500">{t('editEquipment.serviceAreaHint')}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <Label className="mb-1.5 block text-xs">{t('editEquipment.maxRadius')}</Label>
                                    <Input type="number" min="1" placeholder="e.g. 50" className="text-sm"
                                        value={form.serviceRadiusKm} onChange={e => set('serviceRadiusKm', e.target.value)} />
                                </div>
                                <div>
                                    <Label className="mb-1.5 block text-xs">{t('editEquipment.specificPins')}</Label>
                                    <Input placeholder={t('editEquipment.pincodePlaceholder')} className="text-sm"
                                        value={form.servicePincodes} onChange={e => set('servicePincodes', e.target.value)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.images')}</CardTitle></CardHeader>
                        <CardContent>
                            <ImageUploader value={imageUrls} onChange={setImageUrls} maxFiles={5} />
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('editEquipment.specsFeatures')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label className="mb-1.5 block text-xs">{t('editEquipment.featuresLabel')}</Label>
                                <Input placeholder="e.g. Power steering, AC cab" className="text-sm" value={form.features} onChange={e => set('features', e.target.value)} />
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-xs">{t('editEquipment.specificationsLabel')}</Label>
                                <div className="flex gap-2 mb-2">
                                    <Input placeholder={t('editEquipment.keyLabel')} className="flex-1 text-sm" value={form.specKey} onChange={e => set('specKey', e.target.value)} />
                                    <Input placeholder={t('editEquipment.valueLabel')} className="flex-1 text-sm" value={form.specValue} onChange={e => set('specValue', e.target.value)} />
                                    <Button type="button" variant="outline" size="sm" onClick={addSpec}>{t('editEquipment.add')}</Button>
                                </div>
                                {Object.entries(specs).length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(specs).map(([k, v]) => (
                                            <div key={k} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-1 text-xs">
                                                <span className="font-medium">{k}:</span> {v}
                                                <button type="button" onClick={() => removeSpec(k)} title={`Remove ${k}`} aria-label={`Remove specification ${k}`}><X className="h-3 w-3 text-gray-400 hover:text-red-500" /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Button type="submit" size="lg" className="w-full bg-green-700 hover:bg-green-800" disabled={submitting}>
                        {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('editEquipment.saving')}</> : t('editEquipment.saveChanges')}
                    </Button>
                </form>
            </div>
        </div>
    );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X, Plus, MapPin } from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import ImageUploader from '@/components/ImageUploader';
import { useLanguage } from '@/context/LanguageContext';
import type { PickupResult } from '@/components/maps/PickupLocationPicker';

const LocationPicker = dynamic(() => import('@/components/LocationPicker'), {
    ssr: false,
    loading: () => <div className="h-60 bg-gray-100 rounded-xl animate-pulse" />,
});

const PickupLocationPicker = dynamic(
    () => import('@/components/maps/PickupLocationPicker'),
    {
        ssr: false,
        loading: () => (
            <div className="flex flex-col gap-3">
                <div className="h-9 w-44 rounded-xl bg-gray-100 animate-pulse" />
                <div className="h-64 rounded-xl bg-gray-100 animate-pulse" />
                <div className="h-9 rounded-xl bg-gray-100 animate-pulse" />
            </div>
        ),
    },
);

const CATEGORY_GROUPS = [
    { group: 'Land Preparation',     types: ['moldboard-plough', 'disc-plough', 'chisel-plough', 'subsoiler', 'disc-harrow', 'chain-harrow', 'spring-tooth-harrow', 'land-leveler'] },
    { group: 'Soil Cultivation',     types: ['cultivator', 'rotavator', 'power-tiller'] },
    { group: 'Planting Equipment',   types: ['seed-drill', 'planter', 'rice-transplanter', 'broadcast-seeder'] },
    { group: 'Crop Care',            types: ['boom-sprayer', 'air-assisted-sprayer', 'knapsack-sprayer', 'fertilizer-spreader', 'weed-remover'] },
    { group: 'Harvesting Equipment', types: ['reaper', 'combine-harvester', 'thresher'] },
    { group: 'Transport & Support',  types: ['tractor', 'tractor-trailer', 'water-pump', 'baler', 'straw-reaper'] },
];

interface LocationResult { lat: number; lng: number; address: string }

export default function AddEquipmentPage() {
    const router = useRouter();
    const { t }  = useLanguage();

    const [submitting,      setSubmitting]      = useState(false);
    const [location,        setLocation]        = useState<LocationResult | null>(null);
    const [pickupLocation,  setPickupLocation]  = useState<PickupResult | null>(null);
    const [imageUrls,       setImageUrls]       = useState<string[]>([]);
    const [form, setForm] = useState({
        name: '',
        type: 'tractor',
        description: '',
        pricePerDay: '',
        pricePerHour: '',
        securityDeposit: '',
        operatorIncluded: false,
        pincode: '',
        village: '',
        district: '',
        state: '',
        features: '',
        serviceRadiusKm: '50',
        servicePincodes: '',
        specKey: '',
        specValue: '',
    });
    const [specs, setSpecs] = useState<Record<string, string>>({});

    const set = (k: keyof typeof form, v: string | boolean) =>
        setForm(p => ({ ...p, [k]: v }));

    const addSpec = () => {
        if (!form.specKey.trim()) return;
        setSpecs(p => ({ ...p, [form.specKey.trim()]: form.specValue.trim() }));
        setForm(p => ({ ...p, specKey: '', specValue: '' }));
    };

    const removeSpec = (k: string) =>
        setSpecs(p => { const n = { ...p }; delete n[k]; return n; });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name || !form.pricePerDay)
            return toast.error('Name and daily rate are required');
        if (!location)
            return toast.error('Please select equipment location on the map');
        if (!pickupLocation)
            return toast.error('Please pin your equipment\'s pickup location on the map.');

        setSubmitting(true);
        try {
            const res = await nodeApi.post<{ data?: { id?: string }; id?: string }>('/machines', {
                name: form.name,
                type: form.type,
                description: form.description,
                pricing: {
                    baseRatePerDay:   Number(form.pricePerDay),
                    baseRatePerHour:  form.pricePerHour ? Number(form.pricePerHour) : undefined,
                    securityDeposit:  form.securityDeposit ? Number(form.securityDeposit) : 0,
                    operatorIncluded: form.operatorIncluded,
                },
                location: {
                    village:  form.village,
                    town:     form.district || location.address.split(',')[1]?.trim() || form.state,
                    district: form.district || location.address.split(',')[1]?.trim() || form.state,
                    state:    form.state,
                    pincode:  form.pincode || undefined,
                    coordinates: { type: 'Point', coordinates: [location.lng, location.lat] },
                },
                pickup_lat:      pickupLocation.lat,
                pickup_lng:      pickupLocation.lng,
                pickup_address:  pickupLocation.address,
                pickup_landmark: pickupLocation.landmark,
                service_radius_km: Number(form.serviceRadiusKm) || 50,
                service_pincodes:  form.servicePincodes
                    .split(',').map(p => p.trim()).filter(p => /^\d{6}$/.test(p)),
                images:         imageUrls.filter(u => u.trim()),
                features:       form.features.split(',').map(f => f.trim()).filter(Boolean),
                specifications: specs,
            });

            // Also write pickup location directly to Supabase in case the backend
            // does not propagate the new columns yet.
            const equipmentId = res?.data?.id ?? (res as unknown as { id?: string })?.id;
            if (equipmentId && supabase) {
                await supabase
                    .from('equipment')
                    .update({
                        pickup_lat:      pickupLocation.lat,
                        pickup_lng:      pickupLocation.lng,
                        pickup_address:  pickupLocation.address,
                        pickup_landmark: pickupLocation.landmark,
                    } as Record<string, unknown>)
                    .eq('id', equipmentId);
            }

            toast.success('Equipment listed successfully!');
            router.push('/dashboard/owner');
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Failed to add equipment');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="py-8 min-h-screen bg-gray-50">
            <div className="container mx-auto px-4 max-w-2xl">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold mb-1">{t('addEquipment.title')}</h1>
                    <p className="text-gray-500">{t('addEquipment.subtitle')}</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">

                    {/* ── Basic Information ─────────────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('addEquipment.basicInfo')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="equip-name" className="mb-1.5 block">{t('addEquipment.equipmentName')} *</Label>
                                <Input
                                    id="equip-name"
                                    placeholder={t('addEquipment.equipmentNamePlaceholder')}
                                    value={form.name}
                                    onChange={e => set('name', e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="equip-type" className="mb-1.5 block">{t('addEquipment.equipmentType')} *</Label>
                                <select
                                    id="equip-type"
                                    suppressHydrationWarning
                                    value={form.type}
                                    onChange={e => set('type', e.target.value)}
                                    aria-label="Equipment type"
                                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white"
                                >
                                    {CATEGORY_GROUPS.map(g => (
                                        <optgroup key={g.group} label={g.group}>
                                            {g.types.map(ty => (
                                                <option key={ty} value={ty}>{ty.replace(/-/g, ' ')}</option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <Label htmlFor="equip-description" className="mb-1.5 block">{t('equipment.description')}</Label>
                                <textarea
                                    id="equip-description"
                                    suppressHydrationWarning
                                    placeholder={t('addEquipment.descPlaceholder')}
                                    aria-label="Equipment description"
                                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-green-600"
                                    value={form.description}
                                    onChange={e => set('description', e.target.value)}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Pricing ───────────────────────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('addEquipment.pricing')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label htmlFor="price-per-day" className="mb-1.5 block">{t('addEquipment.ratePerDay')} *</Label>
                                    <Input
                                        id="price-per-day"
                                        type="number" placeholder="e.g. 2500" min="0"
                                        value={form.pricePerDay}
                                        onChange={e => set('pricePerDay', e.target.value)}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="price-per-hour" className="mb-1.5 block">{t('addEquipment.ratePerHour')}</Label>
                                    <Input
                                        id="price-per-hour"
                                        type="number" placeholder="Optional" min="0"
                                        value={form.pricePerHour}
                                        onChange={e => set('pricePerHour', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <Label htmlFor="security-deposit" className="mb-1.5 block">{t('equipment.deposit')}</Label>
                                    <Input
                                        id="security-deposit"
                                        type="number" placeholder="Optional" min="0"
                                        value={form.securityDeposit}
                                        onChange={e => set('securityDeposit', e.target.value)}
                                    />
                                </div>
                                <div className="flex items-end pb-1">
                                    <label htmlFor="operator-included" className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            id="operator-included"
                                            type="checkbox"
                                            className="w-4 h-4 accent-green-700"
                                            checked={form.operatorIncluded}
                                            onChange={e => set('operatorIncluded', e.target.checked)}
                                        />
                                        <span className="text-sm font-medium">{t('addEquipment.operatorIncluded')}</span>
                                    </label>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── General Location ──────────────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('location.title')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-xs text-gray-500 mb-3">
                                {t('addEquipment.locationHint')}
                            </p>
                            <LocationPicker onLocationChange={r => {
                                setLocation(r);
                                setForm(p => ({
                                    ...p,
                                    village:  r.parts.village  || p.village,
                                    district: r.parts.district || p.district,
                                    state:    r.parts.state    || p.state,
                                    pincode:  r.parts.pincode  || p.pincode,
                                }));
                            }} />
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                                <div className="sm:col-span-2">
                                    <Label htmlFor="loc-village" className="mb-1.5 block text-xs font-semibold">{t('auth.village')}</Label>
                                    <Input
                                        id="loc-village"
                                        placeholder="e.g. Amangal" className="text-sm"
                                        value={form.village}
                                        onChange={e => set('village', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="loc-district" className="mb-1.5 block text-xs font-semibold">{t('auth.district')}</Label>
                                    <Input
                                        id="loc-district"
                                        placeholder="e.g. Nalgonda" className="text-sm"
                                        value={form.district}
                                        onChange={e => set('district', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="loc-state" className="mb-1.5 block text-xs font-semibold">{t('auth.state')}</Label>
                                    <Input
                                        id="loc-state"
                                        placeholder="e.g. Telangana" className="text-sm"
                                        value={form.state}
                                        onChange={e => set('state', e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Pickup Location (GPS pin) ─────────────────────────── */}
                    <Card className="border-0 shadow-sm border-l-4 border-l-red-400">
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-red-500" />
                                Pickup Location *
                            </CardTitle>
                            <p className="text-xs text-gray-500 mt-1">
                                Pin the exact spot where renters will collect this equipment.
                                This is shown only after payment is confirmed.
                            </p>
                        </CardHeader>
                        <CardContent>
                            <PickupLocationPicker onChange={setPickupLocation} />
                        </CardContent>
                    </Card>

                    {/* ── Service Area ──────────────────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('addEquipment.serviceArea')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-xs text-gray-500">
                                {t('addEquipment.serviceAreaHint')}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <Label htmlFor="service-radius" className="mb-1.5 block text-xs">{t('addEquipment.serviceRadius')}</Label>
                                    <Input
                                        id="service-radius"
                                        type="number" min="1" placeholder="e.g. 50" className="text-sm"
                                        value={form.serviceRadiusKm}
                                        onChange={e => set('serviceRadiusKm', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="service-pincodes" className="mb-1.5 block text-xs">{t('addEquipment.servicePincodes')}</Label>
                                    <Input
                                        id="service-pincodes"
                                        placeholder={t('addEquipment.servicePincodesPlaceholder')} className="text-sm"
                                        value={form.servicePincodes}
                                        onChange={e => set('servicePincodes', e.target.value)}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* ── Images ────────────────────────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('addEquipment.images')}</CardTitle></CardHeader>
                        <CardContent>
                            <ImageUploader value={imageUrls} onChange={setImageUrls} maxFiles={5} />
                        </CardContent>
                    </Card>

                    {/* ── Specifications & Features ─────────────────────────── */}
                    <Card className="border-0 shadow-sm">
                        <CardHeader><CardTitle className="text-base">{t('addEquipment.specificationsFeatures')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div>
                                <Label htmlFor="equip-features" className="mb-1.5 block text-xs">{t('addEquipment.featuresLabel')}</Label>
                                <Input
                                    id="equip-features"
                                    placeholder={t('addEquipment.featuresPlaceholder')} className="text-sm"
                                    value={form.features}
                                    onChange={e => set('features', e.target.value)}
                                />
                            </div>
                            <div>
                                <Label className="mb-1.5 block text-xs">{t('equipment.specifications')}</Label>
                                <div className="flex gap-2 mb-2">
                                    <div className="flex-1">
                                        <label htmlFor="spec-key" className="sr-only">Specification key</label>
                                        <Input
                                            id="spec-key"
                                            placeholder={t('addEquipment.specKeyPlaceholder')} className="text-sm"
                                            value={form.specKey}
                                            onChange={e => set('specKey', e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label htmlFor="spec-value" className="sr-only">Specification value</label>
                                        <Input
                                            id="spec-value"
                                            placeholder={t('addEquipment.specValuePlaceholder')} className="text-sm"
                                            value={form.specValue}
                                            onChange={e => set('specValue', e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                                        />
                                    </div>
                                    <Button type="button" variant="outline" size="sm" onClick={addSpec}>
                                        <Plus className="h-3.5 w-3.5 mr-1" /> {t('addEquipment.add')}
                                    </Button>
                                </div>
                                {Object.keys(specs).length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {Object.entries(specs).map(([k, v]) => (
                                            <div key={k} className="flex items-center gap-1 bg-gray-100 rounded-md px-2 py-1 text-xs">
                                                <span className="font-medium">{k}:</span>
                                                <span>{v}</span>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove ${k} specification`}
                                                    onClick={() => removeSpec(k)}
                                                    className="ml-1 cursor-pointer text-gray-400 hover:text-red-500 transition-colors"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Button
                        type="submit"
                        size="lg"
                        className="w-full bg-green-700 hover:bg-green-800"
                        disabled={submitting}
                    >
                        {submitting
                            ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('addEquipment.listing')}</>
                            : t('addEquipment.title')}
                    </Button>
                </form>
            </div>
        </div>
    );
}

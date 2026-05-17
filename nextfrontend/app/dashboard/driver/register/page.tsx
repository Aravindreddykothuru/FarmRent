'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { nodeApi } from '@/lib/api';
import { Truck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/LanguageContext';

const VEHICLE_TYPES = ['Tractor', 'Harvester', 'Rotavator', 'Sprayer', 'Harrow', 'Other'];

export default function DriverRegisterPage() {
    const router = useRouter();
    const { t } = useLanguage();
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState({
        vehicle_name:   '',
        vehicle_type:   'Tractor',
        vehicle_number: '',
        license_number: '',
    });

    const handle = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setForm(p => ({ ...p, [e.target.name]: e.target.value }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.vehicle_name || !form.vehicle_number)
            return toast.error(t('driver.vehicleRequired'));
        setLoading(true);
        try {
            await nodeApi.post('/drivers/register', form);
            toast.success(t('driver.profileCreated'));
            router.replace('/dashboard/driver');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Registration failed';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl shadow-md border max-w-md w-full p-8 space-y-6">
                <div className="text-center">
                    <div className="inline-flex p-4 bg-green-100 rounded-full mb-3">
                        <Truck className="w-8 h-8 text-green-700" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">{t('driver.becomeDriver')}</h1>
                    <p className="text-gray-500 text-sm mt-1">{t('driver.becomeDriverDesc')}</p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label htmlFor="vehicle_name" className="block text-sm font-medium text-gray-700 mb-1">
                            {t('driver.vehicleName')} *
                        </label>
                        <input
                            id="vehicle_name"
                            name="vehicle_name"
                            suppressHydrationWarning
                            value={form.vehicle_name}
                            onChange={handle}
                            placeholder="e.g. John Deere 5075E"
                            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label htmlFor="vehicle_type" className="block text-sm font-medium text-gray-700 mb-1">
                            {t('driver.vehicleType')} *
                        </label>
                        <select
                            id="vehicle_type"
                            name="vehicle_type"
                            suppressHydrationWarning
                            value={form.vehicle_type}
                            onChange={handle}
                            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none bg-white"
                        >
                            {VEHICLE_TYPES.map(t => <option key={t}>{t}</option>)}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="vehicle_number" className="block text-sm font-medium text-gray-700 mb-1">
                            {t('driver.vehicleNumber')} *
                        </label>
                        <input
                            id="vehicle_number"
                            name="vehicle_number"
                            suppressHydrationWarning
                            value={form.vehicle_number}
                            onChange={handle}
                            placeholder="e.g. TS09AB1234"
                            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                        />
                    </div>

                    <div>
                        <label htmlFor="license_number" className="block text-sm font-medium text-gray-700 mb-1">
                            {t('driver.licenseNumber')}
                        </label>
                        <input
                            id="license_number"
                            name="license_number"
                            suppressHydrationWarning
                            value={form.license_number}
                            onChange={handle}
                            placeholder="Optional"
                            className="w-full border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500 focus:outline-none"
                        />
                    </div>

                    <button
                        type="submit"
                        suppressHydrationWarning
                        disabled={loading}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                        {t('driver.registerAsDriver')}
                    </button>
                </form>
            </div>
        </div>
    );
}

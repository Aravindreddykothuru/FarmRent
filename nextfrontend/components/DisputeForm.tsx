'use client';

import { useState } from 'react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { AlertTriangle, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface Props {
    bookingId: string;
    onSubmit?: () => void;
    onClose?: () => void;
}

export default function DisputeForm({ bookingId, onSubmit, onClose }: Props) {
    const { t } = useLanguage();
    const [type, setType] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const DISPUTE_TYPES = [
        { value: 'equipment_damage', label: t('disputes.equipmentDamage') },
        { value: 'non_return',       label: t('disputes.nonReturn') },
        { value: 'payment_dispute',  label: t('disputes.paymentDispute') },
        { value: 'service_issue',    label: t('disputes.serviceIssue') },
        { value: 'other',            label: t('disputes.other') },
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!type) return toast.error(t('disputes.pleaseSelectType'));
        if (!description.trim() || description.trim().length < 20) return toast.error(t('disputes.descMin20'));

        setSubmitting(true);
        try {
            await nodeApi.post('/disputes', { bookingId, type, description: description.trim() });
            toast.success(t('booking.disputeSubmitted'));
            onSubmit?.();
        } catch (e: any) {
            toast.error(e.message || t('disputes.failedToFile'));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    <h3 className="font-semibold text-orange-800">{t('booking.reportIssue')}</h3>
                </div>
                {onClose && (
                    <button type="button" aria-label={t('common.cancel')} onClick={onClose} className="text-orange-400 hover:text-orange-600">
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="dispute-type" className="block text-sm font-medium text-gray-700 mb-1">{t('disputes.issueType')}</label>
                    <select
                        id="dispute-type"
                        value={type}
                        onChange={e => setType(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                    >
                        <option value="">{t('disputes.chooseType')}</option>
                        {DISPUTE_TYPES.map(dt => (
                            <option key={dt.value} value={dt.value}>{dt.label}</option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('disputes.describeIssue')}</label>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        rows={4}
                        placeholder={t('disputes.descPlaceholder')}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                    />
                    <p className="text-xs text-gray-400 mt-1">{t('disputes.charCount', { count: String(description.length) })}</p>
                </div>

                <p className="text-xs text-orange-700 bg-orange-100 rounded-lg px-3 py-2">
                    {t('disputes.reviewNote')}
                </p>

                <div className="flex gap-3">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="flex-1 bg-orange-600 text-white py-2.5 rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 transition-colors text-sm"
                    >
                        {submitting ? t('disputes.filingDispute') : t('disputes.fileDispute')}
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                        >
                            {t('common.cancel')}
                        </button>
                    )}
                </div>
            </form>
        </div>
    );
}

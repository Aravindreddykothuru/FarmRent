'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    AlertTriangle, Plus, X, ChevronRight, Loader2,
    CheckCircle2, Clock, Eye, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { nodeApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

const DISPUTE_TYPE_VALUES = ['equipment_damage', 'non_return', 'payment_dispute', 'service_issue', 'other'] as const;
type DisputeType = typeof DISPUTE_TYPE_VALUES[number];

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
    open:               { color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
    under_review:       { color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
    resolved_farmer:    { color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
    resolved_owner:     { color: 'text-green-700',  bg: 'bg-green-50 border-green-200' },
    closed:             { color: 'text-gray-500',   bg: 'bg-gray-50 border-gray-200' },
};

interface Booking { id: string; start_date: string; end_date: string; equipment?: { name: string } }
interface Dispute {
    id: string;
    type: string;
    description: string;
    status: string;
    admin_notes?: string;
    created_at: string;
    bookings?: Booking;
}

export default function DisputesPage() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();
    const { t } = useLanguage();

    const [disputes,  setDisputes]  = useState<Dispute[]>([]);
    const [bookings,  setBookings]  = useState<Booking[]>([]);
    const [loading,   setLoading]   = useState(true);
    const [showForm,  setShowForm]  = useState(false);
    const [expanded,  setExpanded]  = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError,  setFormError]  = useState('');

    const [form, setForm] = useState({
        bookingId:   '',
        type:        '' as DisputeType | '',
        description: '',
    });

    const DISPUTE_TYPES = [
        { value: 'equipment_damage' as DisputeType,  label: t('disputes.equipmentDamage') },
        { value: 'non_return' as DisputeType,        label: t('disputes.nonReturn') },
        { value: 'payment_dispute' as DisputeType,   label: t('disputes.paymentDispute') },
        { value: 'service_issue' as DisputeType,     label: t('disputes.serviceIssue') },
        { value: 'other' as DisputeType,             label: t('disputes.other') },
    ];

    const STATUS_LABELS: Record<string, string> = {
        open:            t('disputes.open'),
        under_review:    t('disputes.underReview'),
        resolved_farmer: t('disputes.resolvedFarmer'),
        resolved_owner:  t('disputes.resolvedOwner'),
        closed:          t('disputes.closed'),
    };

    const statusCfg = (s: string) => ({
        label: STATUS_LABELS[s] ?? s,
        ...(STATUS_COLORS[s] ?? { color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' }),
    });

    useEffect(() => {
        if (!authLoading && !user) { router.replace('/login?next=/disputes'); return; }
    }, [authLoading, user, router]);

    useEffect(() => {
        if (!user) return;
        Promise.all([
            nodeApi.get<{ disputes: Dispute[] }>('/disputes/my'),
            nodeApi.get<{ bookings: Booking[] }>('/bookings/my'),
        ]).then(([d, b]) => {
            setDisputes(d.disputes || []);
            setBookings(b.bookings || []);
        }).catch(() => {}).finally(() => setLoading(false));
    }, [user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        if (!form.bookingId) { setFormError(t('disputes.pleaseSelectBooking')); return; }
        if (!form.type)       { setFormError(t('disputes.pleaseSelectType')); return; }
        if (!form.description.trim()) { setFormError(t('disputes.pleaseDescribeIssue')); return; }
        if (form.description.trim().length < 20) { setFormError(t('disputes.descMin20')); return; }

        setSubmitting(true);
        try {
            const res = await nodeApi.post<{ success: boolean; dispute: Dispute }>('/disputes', {
                bookingId:   form.bookingId,
                type:        form.type,
                description: form.description.trim(),
            });
            setDisputes(prev => [res.dispute, ...prev]);
            setShowForm(false);
            setForm({ bookingId: '', type: '', description: '' });
        } catch (err: unknown) {
            setFormError(err instanceof Error ? err.message : t('disputes.failedToFile'));
        } finally {
            setSubmitting(false);
        }
    };

    if (authLoading || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA]">
                <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
            </div>
        );
    }


    return (
        <div className="min-h-screen bg-[#F7F8FA]">
            <div className="max-w-3xl mx-auto px-4 py-10">

                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-black text-gray-900">{t('disputes.title')}</h1>
                        <p className="text-gray-500 text-sm mt-1">{t('disputes.subtitle')}</p>
                    </div>
                    <Button
                        className="bg-green-700 hover:bg-green-800 rounded-xl font-bold gap-2"
                        onClick={() => { setShowForm(v => !v); setFormError(''); }}
                    >
                        {showForm ? <><X className="w-4 h-4" /> {t('common.cancel')}</> : <><Plus className="w-4 h-4" /> {t('disputes.newDispute')}</>}
                    </Button>
                </div>

                {/* New dispute form */}
                {showForm && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
                        <div className="flex items-center gap-2 mb-5">
                            <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                            </div>
                            <h2 className="text-base font-bold text-gray-900">{t('disputes.fileNew')}</h2>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Booking selector */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    {t('disputes.selectBooking')} <span className="text-red-500">*</span>
                                </label>
                                {bookings.length === 0 ? (
                                    <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
                                        {t('disputes.noBookings')}{' '}
                                        <Link href="/dashboard/farmer" className="text-green-700 font-semibold hover:underline">
                                            {t('disputes.makeBookingFirst')}
                                        </Link>
                                    </p>
                                ) : (
                                    <select
                                        value={form.bookingId}
                                        onChange={e => setForm(f => ({ ...f, bookingId: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                                    >
                                        <option value="">{t('disputes.chooseBooking')}</option>
                                        {bookings.map(b => (
                                            <option key={b.id} value={b.id}>
                                                {b.equipment?.name ?? t('disputes.bookingRef')} · {b.start_date} → {b.end_date}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* Dispute type */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    {t('disputes.disputeType')} <span className="text-red-500">*</span>
                                </label>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {DISPUTE_TYPES.map(dt => (
                                        <button
                                            key={dt.value}
                                            type="button"
                                            onClick={() => setForm(f => ({ ...f, type: dt.value }))}
                                            className={`border-2 rounded-xl px-3 py-2.5 text-xs font-semibold text-left transition-all ${
                                                form.type === dt.value
                                                    ? 'border-red-400 bg-red-50 text-red-700'
                                                    : 'border-gray-100 text-gray-600 hover:border-gray-200 hover:bg-gray-50'
                                            }`}
                                        >
                                            {dt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                                    {t('disputes.describeIssue')} <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    value={form.description}
                                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                                    rows={4}
                                    placeholder={t('disputes.descPlaceholder')}
                                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                                />
                                <p className="text-xs text-gray-400 mt-1 text-right">{form.description.length} / 1000</p>
                            </div>

                            {formError && (
                                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                                    {formError}
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={submitting || bookings.length === 0}
                                className="w-full bg-red-600 hover:bg-red-700 font-bold rounded-xl h-11"
                            >
                                {submitting
                                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('disputes.filingDispute')}</>
                                    : t('disputes.fileDispute')}
                            </Button>
                        </form>
                    </div>
                )}

                {/* Disputes list */}
                {disputes.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                        <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                        <h3 className="font-bold text-gray-700 mb-1">{t('disputes.noDisputes')}</h3>
                        <p className="text-sm text-gray-400">
                            {t('disputes.noDisputesDesc')}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {disputes.map(d => {
                            const cfg = statusCfg(d.status);
                            const isOpen = expanded === d.id;
                            const typeLabel = DISPUTE_TYPES.find(dt => dt.value === d.type)?.label ?? d.type;

                            return (
                                <div key={d.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setExpanded(isOpen ? null : d.id)}
                                        className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-gray-50 transition-colors"
                                    >
                                        <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
                                            {d.status === 'open'         && <Clock className={`w-4 h-4 ${cfg.color}`} />}
                                            {d.status === 'under_review' && <Eye className={`w-4 h-4 ${cfg.color}`} />}
                                            {(d.status === 'resolved_farmer' || d.status === 'resolved_owner') && <CheckCircle2 className={`w-4 h-4 ${cfg.color}`} />}
                                            {d.status === 'closed'       && <X className={`w-4 h-4 ${cfg.color}`} />}
                                            {!STATUS_COLORS[d.status]    && <AlertTriangle className={`w-4 h-4 ${cfg.color}`} />}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-bold text-gray-900">{typeLabel}</span>
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
                                                    {cfg.label}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-400 mt-0.5">
                                                {d.bookings?.equipment?.name
                                                    ? `${d.bookings.equipment.name} · `
                                                    : ''}
                                                {t('disputes.filedOn')} {new Date(d.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </p>
                                        </div>

                                        <ChevronRight className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                    </button>

                                    {isOpen && (
                                        <div className="px-5 pb-5 border-t border-gray-50 pt-4 space-y-3">
                                            <div>
                                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{t('disputes.yourDescription')}</p>
                                                <p className="text-sm text-gray-700 leading-relaxed">{d.description}</p>
                                            </div>

                                            {d.admin_notes && (
                                                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                                                    <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-1">{t('disputes.adminNotes')}</p>
                                                    <p className="text-sm text-blue-700 leading-relaxed">{d.admin_notes}</p>
                                                </div>
                                            )}

                                            <p className="text-xs text-gray-400">
                                                {t('disputes.bookingRef')}: <span className="font-mono">{d.id.slice(0, 8).toUpperCase()}</span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

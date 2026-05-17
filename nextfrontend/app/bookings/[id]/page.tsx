'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    ChevronLeft, Loader2, MapPin, Calendar, Clock,
    Star, CheckCircle2, XCircle, AlertCircle, Download,
    RotateCcw, Share2, KeyRound, Navigation,
} from 'lucide-react';
import { nodeApi, invoicesApi } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { connectSocket } from '@/lib/socket';
import { toast } from 'sonner';
import BookingChat from '@/components/BookingChat';
import DisputeForm from '@/components/DisputeForm';
import BookingPass from '@/components/BookingPass';
import { useLanguage } from '@/context/LanguageContext';
import dynamic from 'next/dynamic';

const PickupLocationReveal = dynamic(
    () => import('@/components/maps/PickupLocationReveal'),
    { ssr: false, loading: () => <div className="h-48 rounded-2xl bg-gray-100 animate-pulse" /> },
);

interface Booking {
    id?: string;
    _id?: string;
    status: string;
    paymentStatus?: string;
    paymentMethod?: string;
    payment_method?: string;
    startDate: string;
    endDate: string;
    totalAmount: number;
    serviceFee?: number;
    machineId?: string;
    farmerName?: string;
    machine?: { _id?: string; id?: string; name: string; type?: string; images?: string[]; location?: { district?: string } };
    renter?: { name: string; email?: string };
    owner?: { name: string };
    notes?: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
    pending:     { label: 'Pending Approval',  color: 'bg-yellow-100 text-yellow-700', Icon: Clock },
    requested:   { label: 'Requested',         color: 'bg-blue-100 text-blue-700',    Icon: Clock },
    confirmed:   { label: 'Confirmed',         color: 'bg-green-100 text-green-700',  Icon: CheckCircle2 },
    in_progress: { label: 'In Progress',       color: 'bg-indigo-100 text-indigo-700', Icon: Clock },
    completed:   { label: 'Completed',         color: 'bg-gray-100 text-gray-700',    Icon: CheckCircle2 },
    cancelled:   { label: 'Cancelled',         color: 'bg-red-100 text-red-600',      Icon: XCircle },
};

export default function BookingDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router  = useRouter();
    const { t }   = useLanguage();

    const [booking,            setBooking]           = useState<Booking | null>(null);
    const [loading,            setLoading]           = useState(true);
    const [userRole,           setUserRole]          = useState('');
    const [acting,             setActing]            = useState(false);
    // Review
    const [showReview,         setShowReview]        = useState(false);
    const [rating,             setRating]            = useState(5);
    const [reviewText,         setReviewText]        = useState('');
    const [reviewed,           setReviewed]          = useState(false);
    // Dispute
    const [showDispute,        setShowDispute]       = useState(false);
    const [disputed,           setDisputed]          = useState(false);
    // Refund
    const [refundInfo,         setRefundInfo]        = useState<{ status?: string; refund_id?: string; refunded_at?: string; refund_amount_paise?: number } | null>(null);
    const [requestingRefund,   setRequestingRefund]  = useState(false);
    // Invoice
    const [downloadingInvoice, setDownloadingInvoice] = useState(false);
    // Pickup location (fetched from Supabase after booking confirms)
    const [pickupInfo, setPickupInfo] = useState<{
        lat: number; lng: number; address: string; landmark?: string;
        ownerPhone?: string;
    } | null>(null);
    // Work completion OTP (owner side)
    const [showCompletionOtp,  setShowCompletionOtp] = useState(false);
    const [completionOtp,      setCompletionOtp]     = useState('');
    const [completingWork,     setCompletingWork]    = useState(false);
    const [farmerOtp,          setFarmerOtp]         = useState<string | null>(null);

    useEffect(() => {
        if (!id) return;
        const token = localStorage.getItem('authToken');
        if (token) {
            try {
                const p = JSON.parse(atob(token.split('.')[1]));
                setUserRole(p.role || '');
                // If farmer in_progress booking — get OTP to show to owner
                if (p.role === 'farmer') {
                    nodeApi.get<{ otp?: string }>(`/bookings/${id}/completion-otp`)
                        .then(r => { if (r?.otp) setFarmerOtp(r.otp); })
                        .catch(() => {});
                }
            } catch { /**/ }
        }

        nodeApi.get<any>(`/bookings/${id}`)
            .then(async r => {
                const b = r?.data || r;
                if (b?.machineId && !b.machine) {
                    try {
                        const m = await nodeApi.get<any>(`/machines/${b.machineId}`);
                        b.machine = { ...(m?.data ?? m), name: (m?.data ?? m)?.name ?? 'Equipment', _id: b.machineId, id: b.machineId };
                    } catch { b.machine = { name: 'Equipment', _id: b.machineId, id: b.machineId }; }
                }
                setBooking(b);
            })
            .catch(() => toast.error('Could not load booking'))
            .finally(() => setLoading(false));

        const socket = connectSocket(token || undefined);
        socket.emit('join:booking', id);
        socket.on('booking:updated', (data: { id: string; status: string }) => {
            if (data.id === id || data.id?.toString() === id) {
                setBooking(prev => prev ? { ...prev, status: data.status } : prev);
                toast.info(`Booking status: ${data.status}`);
            }
        });

        nodeApi.get<any>(`/payment/refund-status?bookingId=${id}`)
            .then(r => { if (r?.refund?.status === 'refunded') setRefundInfo(r.refund); })
            .catch(() => {});

        // Fetch pickup location from Supabase once booking is confirmed + paid
        if (supabase) {
            nodeApi.get<any>(`/bookings/${id}`)
                .then(async r => {
                    const b = r?.data || r;
                    const isConfirmedPaid =
                        ['confirmed', 'in_progress', 'active', 'completed'].includes(b?.status) &&
                        b?.paymentStatus === 'paid';
                    if (!isConfirmedPaid) return;
                    const machineId = b?.machineId ?? b?.machine?._id ?? b?.machine?.id;
                    if (!machineId) return;
                    const { data: eq } = await supabase!
                        .from('equipment')
                        .select('pickup_lat, pickup_lng, pickup_address, pickup_landmark')
                        .eq('id', machineId)
                        .single();
                    const row = eq as Record<string, unknown> | null;
                    if (row?.pickup_lat && row?.pickup_lng) {
                        setPickupInfo({
                            lat:      Number(row.pickup_lat),
                            lng:      Number(row.pickup_lng),
                            address:  String(row.pickup_address ?? ''),
                            landmark: row.pickup_landmark ? String(row.pickup_landmark) : undefined,
                        });
                    }
                })
                .catch(() => {});
        }

        return () => { socket.off('booking:updated'); };
    }, [id]);

    const handleAction = async (action: 'accept' | 'reject' | 'cancel') => {
        setActing(true);
        try {
            const path = action === 'cancel' ? `/bookings/${id}/cancel` : `/bookings/${id}/${action}`;
            await nodeApi.patch<any>(path, {});
            const newStatus = action === 'cancel' || action === 'reject' ? 'cancelled' : 'confirmed';
            setBooking(prev => prev ? { ...prev, status: newStatus } : prev);
            toast.success(`Booking ${action}ed`);
        } catch (e: any) { toast.error(e.message || 'Action failed'); }
        finally { setActing(false); }
    };

    const handleReview = async () => {
        try {
            await nodeApi.post('/reviews', { bookingId: id, rating, reviewText });
            toast.success('Review submitted! +10 FarmCoins earned 🪙');
            setReviewed(true); setShowReview(false);
        } catch (e: any) { toast.error(e.message || 'Failed to submit review'); }
    };

    const handleRefundRequest = async () => {
        setRequestingRefund(true);
        try {
            const r: any = await nodeApi.post('/payment/refund', { bookingId: id });
            setRefundInfo({ status: 'refunded', refund_id: r?.refund_id, refunded_at: new Date().toISOString(), refund_amount_paise: r?.amount_paise });
            toast.success('Refund initiated — expect 5-7 business days');
        } catch (e: any) { toast.error(e.message || 'Refund failed — contact support'); }
        finally { setRequestingRefund(false); }
    };

    const handleWorkComplete = async () => {
        if (completionOtp.length !== 6) { toast.error('Enter the 6-digit OTP shown on farmer\'s app'); return; }
        setCompletingWork(true);
        try {
            await nodeApi.post(`/bookings/${id}/complete`, { otp: completionOtp });
            setBooking(prev => prev ? { ...prev, status: 'completed' } : prev);
            toast.success('Work marked complete! Payment will be released in 24 hours.');
            setShowCompletionOtp(false);
        } catch (e: any) { toast.error(e.message || 'Invalid OTP — check with the farmer'); }
        finally { setCompletingWork(false); }
    };

    const repeatBooking = () => {
        const mid = booking?.machine?._id ?? booking?.machine?.id ?? booking?.machineId;
        if (mid) router.push(`/book/${mid}`);
        else toast.error('Equipment no longer available');
    };

    const shareWhatsApp = () => {
        if (!booking) return;
        const msg = [
            `🚜 FarmRent Booking Update`,
            `Equipment: ${booking.machine?.name ?? 'Equipment'}`,
            `Status: ${booking.status}`,
            `Dates: ${new Date(booking.startDate).toLocaleDateString('en-IN')} → ${new Date(booking.endDate).toLocaleDateString('en-IN')}`,
            `View: ${window.location.href}`,
        ].join('\n');
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-green-700" />
        </div>
    );

    if (!booking) return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-xl">{t('booking.bookingNotFound')}</p>
            <Link href="/dashboard"><Button variant="outline">{t('nav.dashboard')}</Button></Link>
        </div>
    );

    const statusCfg  = STATUS_CONFIG[booking.status] ?? { label: booking.status, color: 'bg-gray-100 text-gray-600', Icon: Clock };
    const StatusIcon = statusCfg.Icon;
    const isCompleted = ['completed', 'confirmed'].includes(booking.status);
    const isInProgress = booking.status === 'in_progress';
    const bookingId  = booking.id ?? booking._id ?? id;

    const isRefundEligible = (() => {
        if (booking.status !== 'cancelled') return false;
        if (booking.paymentStatus !== 'paid') return false;
        if (refundInfo?.status === 'refunded') return false;
        return new Date(booking.startDate).getTime() - Date.now() > 24 * 60 * 60 * 1000;
    })();

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Top bar */}
            <div className="bg-white border-b sticky top-0 z-10">
                <div className="container mx-auto px-4 py-3 max-w-2xl flex items-center justify-between">
                    <Link href="/bookings" className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline">
                        <ChevronLeft className="h-4 w-4" /> My Bookings
                    </Link>
                    <button type="button" onClick={shareWhatsApp} aria-label="Share booking on WhatsApp" className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
                        <Share2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="container mx-auto px-4 max-w-2xl py-6 space-y-4">

                {/* ── mBooking Pass (for confirmed / in_progress bookings) ── */}
                {['confirmed', 'in_progress', 'completed'].includes(booking.status) && (
                    <BookingPass
                        bookingId={bookingId}
                        equipmentName={booking.machine?.name ?? 'Equipment'}
                        equipmentType={booking.machine?.type}
                        farmerName={booking.renter?.name ?? booking.farmerName ?? 'Farmer'}
                        ownerName={booking.owner?.name}
                        startDate={booking.startDate}
                        endDate={booking.endDate}
                        totalAmount={booking.totalAmount}
                        status={booking.status}
                        district={booking.machine?.location?.district}
                        paymentStatus={booking.paymentStatus}
                    />
                )}

                {/* Status card */}
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-5">
                        <div className="flex items-center gap-3 mb-2">
                            <StatusIcon className="h-5 w-5 text-gray-500" />
                            <span className="font-bold text-gray-800">{t('booking.bookingStatus')}</span>
                        </div>
                        <Badge className={`text-sm px-3 py-1 ${statusCfg.color} border-0`}>
                            {statusCfg.label}
                        </Badge>
                        <p className="text-xs text-gray-400 mt-2 font-mono">
                            #{bookingId.slice(-12).toUpperCase()}
                        </p>
                        {booking.paymentStatus === 'paid' && (
                            <p className="text-xs text-green-600 mt-1 font-semibold">✅ Payment confirmed</p>
                        )}
                    </CardContent>
                </Card>

                {/* Farmer OTP for work completion (shown when in_progress) */}
                {userRole === 'farmer' && isInProgress && farmerOtp && (
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <KeyRound className="h-4 w-4 text-green-700" />
                                <span className="font-bold text-green-800 text-sm">Work Completion OTP</span>
                            </div>
                            <p className="text-xs text-green-700 mb-3">
                                Show this OTP to the equipment owner to mark work complete and release payment.
                            </p>
                            <div className="flex items-center justify-center bg-white rounded-xl border-2 border-green-300 py-4">
                                <span className="text-4xl font-black font-mono tracking-[0.5rem] text-green-800">{farmerOtp}</span>
                            </div>
                            <p className="text-xs text-center text-green-600 mt-2">Valid for this booking session only</p>
                        </CardContent>
                    </Card>
                )}

                {/* Machine info */}
                {booking.machine && (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                            <h3 className="font-semibold mb-3 text-sm text-gray-700">{t('booking.equipmentSection')}</h3>
                            <div className="flex gap-4">
                                <div className="w-20 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0">
                                    <img
                                        src={booking.machine.images?.[0] || 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200'}
                                        alt={booking.machine.name}
                                        className="w-full h-full object-cover"
                                        onError={e => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200'; }}
                                    />
                                </div>
                                <div>
                                    <p className="font-bold text-gray-900">{booking.machine.name}</p>
                                    {booking.machine.type && <p className="text-xs text-gray-500 mt-0.5">{booking.machine.type}</p>}
                                    {booking.machine.location?.district && (
                                        <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                            <MapPin className="h-3 w-3 text-green-600" />{booking.machine.location.district}
                                        </p>
                                    )}
                                    <Link
                                        href={`/equipment/${booking.machine._id ?? booking.machine.id ?? booking.machineId}`}
                                        className="text-xs text-green-700 underline mt-1.5 block"
                                    >
                                        View equipment →
                                    </Link>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* ── Pickup Location card (shown only after confirmed + paid) ── */}
                {pickupInfo && (
                    <PickupLocationReveal
                        lat={pickupInfo.lat}
                        lng={pickupInfo.lng}
                        address={pickupInfo.address}
                        landmark={pickupInfo.landmark}
                        equipmentName={booking.machine?.name ?? 'Equipment'}
                        ownerName={booking.owner?.name}
                        ownerPhone={pickupInfo.ownerPhone}
                        bookingId={bookingId}
                        canTrack={['confirmed', 'in_progress', 'active'].includes(booking.status)}
                        onStartTracking={() => router.push(`/dashboard/track/${bookingId}`)}
                    />
                )}

                {/* Dates + pricing */}
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-5">
                        <h3 className="font-semibold mb-3 text-sm text-gray-700">{t('booking.bookingDetails')}</h3>
                        <div className="space-y-2.5 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-green-600" /> Start Date</span>
                                <span className="font-semibold">{new Date(booking.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-green-600" /> End Date</span>
                                <span className="font-semibold">{new Date(booking.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                            </div>
                            {booking.serviceFee != null && (
                                <div className="flex justify-between text-gray-500">
                                    <span>Service fee (3%)</span>
                                    <span>₹{booking.serviceFee.toLocaleString('en-IN')}</span>
                                </div>
                            )}
                            {(booking.paymentMethod === 'cod' || booking.payment_method === 'cod') && (
                                <div className="flex justify-between text-amber-700">
                                    <span>Payment Method</span>
                                    <span className="font-semibold">💵 Cash on Delivery</span>
                                </div>
                            )}
                            <div className="flex justify-between pt-2 border-t font-bold">
                                <span>Total Paid</span>
                                <span className="text-green-700 text-base">₹{booking.totalAmount?.toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Track delivery (for active/confirmed bookings) */}
                {['confirmed', 'in_progress', 'requested'].includes(booking.status) && (
                    <Link href={`/tracking/${bookingId}`}>
                        <Button className="w-full bg-indigo-700 hover:bg-indigo-800 rounded-xl gap-2 font-bold">
                            <Navigation className="h-4 w-4" /> Track Live Location
                        </Button>
                    </Link>
                )}

                {/* ── Owner actions ── */}
                {userRole === 'owner' && booking.status === 'pending' && (
                    <div className="flex gap-3">
                        <Button className="flex-1 bg-green-700 hover:bg-green-800 rounded-xl" onClick={() => handleAction('accept')} disabled={acting}>
                            {acting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            {t('booking.accept')}
                        </Button>
                        <Button variant="destructive" className="flex-1 rounded-xl" onClick={() => handleAction('reject')} disabled={acting}>
                            <XCircle className="h-4 w-4 mr-2" /> Reject
                        </Button>
                    </div>
                )}

                {/* Owner: Work Completion OTP entry */}
                {userRole === 'owner' && isInProgress && (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                            {!showCompletionOtp ? (
                                <Button
                                    className="w-full bg-green-700 hover:bg-green-800 rounded-xl gap-2"
                                    onClick={() => setShowCompletionOtp(true)}
                                >
                                    <CheckCircle2 className="h-4 w-4" /> Mark Work Complete
                                </Button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <KeyRound className="h-4 w-4 text-green-700" />
                                        <h3 className="font-bold text-gray-800 text-sm">Enter Farmer's OTP</h3>
                                    </div>
                                    <p className="text-xs text-gray-500">Ask the farmer to show the 6-digit OTP from their app to confirm work completion.</p>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        placeholder="Enter 6-digit OTP"
                                        value={completionOtp}
                                        maxLength={6}
                                        onChange={e => setCompletionOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-2xl font-mono font-black tracking-[1rem] focus:outline-none focus:border-green-500"
                                    />
                                    <div className="flex gap-2">
                                        <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setShowCompletionOtp(false); setCompletionOtp(''); }}>
                                            Cancel
                                        </Button>
                                        <Button
                                            className="flex-1 bg-green-700 hover:bg-green-800 rounded-xl"
                                            onClick={handleWorkComplete}
                                            disabled={completionOtp.length !== 6 || completingWork}
                                        >
                                            {completingWork ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Complete'}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Farmer: Cancel */}
                {userRole === 'farmer' && ['pending', 'confirmed', 'requested'].includes(booking.status) && (
                    <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50 rounded-xl"
                        onClick={() => handleAction('cancel')} disabled={acting}>
                        {t('booking.cancelBooking')}
                    </Button>
                )}

                {/* Repeat Booking */}
                {booking.status === 'completed' && (
                    <Button variant="outline" className="w-full border-green-300 text-green-700 hover:bg-green-50 rounded-xl gap-2 font-bold"
                        onClick={repeatBooking}>
                        <RotateCcw className="h-4 w-4" /> Book Again (Same Equipment)
                    </Button>
                )}

                {/* Review */}
                {userRole === 'farmer' && isCompleted && !reviewed && (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                            {!showReview ? (
                                <Button className="w-full bg-yellow-500 hover:bg-yellow-600 rounded-xl gap-2 font-bold text-white"
                                    onClick={() => setShowReview(true)}>
                                    <Star className="h-4 w-4" /> Rate & Review · Earn 10 FarmCoins
                                </Button>
                            ) : (
                                <div className="space-y-4">
                                    <h3 className="font-bold">{t('booking.rateEquipment')}</h3>
                                    <div className="flex gap-2">
                                        {[1, 2, 3, 4, 5].map(n => (
                                            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`Rate ${n} stars`}>
                                                <Star className={`h-8 w-8 transition-all ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
                                            </button>
                                        ))}
                                    </div>
                                    <Textarea placeholder="How was the equipment and owner? (optional)" value={reviewText} onChange={e => setReviewText(e.target.value)} rows={3} className="rounded-xl" />
                                    <div className="flex gap-3">
                                        <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowReview(false)}>Cancel</Button>
                                        <Button className="flex-1 bg-green-700 hover:bg-green-800 rounded-xl" onClick={handleReview}>Submit Review</Button>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {reviewed && (
                    <div className="text-center text-green-700 font-semibold py-2 text-sm">
                        ✅ Review submitted — 10 FarmCoins credited!
                    </div>
                )}

                {/* Refund request */}
                {isRefundEligible && (
                    <Button variant="outline" className="w-full border-blue-300 text-blue-700 hover:bg-blue-50 font-semibold rounded-xl"
                        disabled={requestingRefund} onClick={handleRefundRequest}>
                        {requestingRefund ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Processing...</> : '💰 Request Refund'}
                    </Button>
                )}

                {refundInfo && (
                    <Card className="border-0 shadow-sm bg-blue-50">
                        <CardContent className="p-5">
                            <p className="font-semibold text-blue-800 mb-1">Refund Status</p>
                            <p className="text-sm text-blue-700">
                                {refundInfo.refund_amount_paise
                                    ? `₹${Math.round(refundInfo.refund_amount_paise / 100)} refund initiated`
                                    : 'Refund initiated'
                                }
                                {refundInfo.refunded_at ? ` on ${new Date(refundInfo.refunded_at).toLocaleDateString('en-IN')}` : ''}.
                                Expect 5-7 business days.
                            </p>
                            {refundInfo.refund_id && (
                                <p className="text-xs text-blue-500 mt-1 font-mono">ID: {refundInfo.refund_id}</p>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Chat */}
                {booking.status !== 'cancelled' && <BookingChat bookingId={id} />}

                {/* Invoice download */}
                {booking.status === 'completed' && (
                    <Button variant="outline" className="w-full rounded-xl gap-2"
                        disabled={downloadingInvoice}
                        onClick={async () => {
                            setDownloadingInvoice(true);
                            try { await invoicesApi.download(id); }
                            catch (e: any) { toast.error(e.message || 'Invoice download failed'); }
                            finally { setDownloadingInvoice(false); }
                        }}>
                        {downloadingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Download Invoice (PDF)
                    </Button>
                )}

                {/* Dispute */}
                {booking.status === 'completed' && !disputed && !showDispute && (
                    <Button variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50 rounded-xl"
                        onClick={() => setShowDispute(true)}>
                        {t('booking.reportIssue')}
                    </Button>
                )}
                {showDispute && !disputed && (
                    <DisputeForm bookingId={id} onSubmit={() => { setDisputed(true); setShowDispute(false); }} onClose={() => setShowDispute(false)} />
                )}
                {disputed && (
                    <div className="text-center text-orange-700 font-medium py-2 text-sm">✅ Dispute submitted — admin will review within 48 hours</div>
                )}
            </div>
        </div>
    );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    ChevronLeft, Loader2, MapPin, Calendar, Clock,
    Star, CheckCircle2, XCircle, AlertCircle, Download,
    RotateCcw, Share2, KeyRound, Navigation, Truck, Undo2, CreditCard,
} from 'lucide-react';
import { nodeApi, invoicesApi, razorpayApi } from '@/lib/api';
import { connectTrackingSocket } from '@/lib/socket';
import { toast } from 'sonner';
import BookingChat from '@/components/BookingChat';
import DisputeForm from '@/components/DisputeForm';
import BookingPass from '@/components/BookingPass';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRazorpay } from '@/hooks/useRazorpay';
import dynamic from 'next/dynamic';

const PickupLocationReveal = dynamic(
    () => import('@/components/maps/PickupLocationReveal'),
    { ssr: false, loading: () => <div className="h-48 rounded-2xl bg-gray-100 animate-pulse" /> },
);

interface Party { id: string; name: string; phone?: string | null; email?: string | null }

// Shape returned by GET /api/v1/bookings/:id (toClientBooking in the booking service)
interface Booking {
    id: string;
    _id?: string;
    status: string;
    renter_id: string;
    owner_id: string;
    paymentStatus?: string;
    paymentMethod?: string;
    startDate: string;
    endDate: string;
    totalDays?: number;
    subtotal?: number | null;
    service_fee?: number;
    deposit_amount?: number;
    delivery_charge?: number;
    discount_amount?: number;
    totalAmount: number;
    machineId?: string;
    farmerName?: string | null;
    delivery_mode?: string;
    field_address?: string | null;
    machine?: { _id?: string; id?: string; name: string; type?: string; images?: string[]; location?: { district?: string } } | null;
    renter?: Party | null;
    owner?: Party | null;
    pickup?: { lat: number; lng: number; address: string; landmark?: string | null } | null;
    completion_otp?: string;
}

interface RefundInfo { status?: string; refund_id?: string | null; refunded_at?: string | null; refund_amount_paise?: number }

type Action = 'accept' | 'reject' | 'cancel' | 'start' | 'return';

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ComponentType<{ className?: string }> }> = {
    pending:        { label: 'Pending Approval', color: 'bg-yellow-100 text-yellow-700', Icon: Clock },
    confirmed:      { label: 'Confirmed',        color: 'bg-green-100 text-green-700',   Icon: CheckCircle2 },
    in_progress:    { label: 'In Progress',      color: 'bg-indigo-100 text-indigo-700', Icon: Clock },
    return_pending: { label: 'Return Pending',   color: 'bg-indigo-100 text-indigo-700', Icon: Undo2 },
    completed:      { label: 'Completed',        color: 'bg-gray-100 text-gray-700',     Icon: CheckCircle2 },
    cancelled:      { label: 'Cancelled',        color: 'bg-red-100 text-red-600',       Icon: XCircle },
    rejected:       { label: 'Declined',         color: 'bg-red-100 text-red-600',       Icon: XCircle },
};

const ACTIONS: Record<Action, { method: 'patch' | 'post'; success: string }> = {
    accept: { method: 'patch', success: 'Booking confirmed' },
    reject: { method: 'patch', success: 'Booking declined' },
    cancel: { method: 'patch', success: 'Booking cancelled' },
    start:  { method: 'patch', success: 'Rental started — equipment handed over' },
    return: { method: 'post',  success: 'Return started — show your completion code to the owner' },
};

const IN_USE = ['in_progress', 'return_pending'];
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200';
const inr = (value?: number | null) => `₹${Number(value ?? 0).toLocaleString('en-IN')}`;
const formatDate = (value: string) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export default function BookingDetailPage() {
    const { id } = useParams<{ id: string }>();
    const router  = useRouter();
    const { t }   = useLanguage();
    const { user } = useAuth();

    const [booking,            setBooking]           = useState<Booking | null>(null);
    const [loading,            setLoading]           = useState(true);
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
    const [refundInfo,         setRefundInfo]        = useState<RefundInfo | null>(null);
    const [requestingRefund,   setRequestingRefund]  = useState(false);
    // Invoice
    const [downloadingInvoice, setDownloadingInvoice] = useState(false);
    // Completion code: the renter sees it, the owner types it in
    const [renterOtp,          setRenterOtp]         = useState<string | null>(null);
    const [showCompletionOtp,  setShowCompletionOtp] = useState(false);
    const [completionOtp,      setCompletionOtp]     = useState('');
    const [completingWork,     setCompletingWork]    = useState(false);

    const { startCheckout, loading: paying } = useRazorpay();

    const isOwner  = Boolean(user && booking && booking.owner_id === user.id);
    const isRenter = Boolean(user && booking && booking.renter_id === user.id);

    const loadBooking = useCallback(async () => {
        const data = await nodeApi.get<Booking>(`/bookings/${id}`);
        setBooking(data);
        return data;
    }, [id]);

    useEffect(() => {
        if (!id) return;
        loadBooking()
            .catch((e: unknown) => toast.error(errorMessage(e, 'Could not load booking')))
            .finally(() => setLoading(false));
    }, [id, loadBooking]);

    // Live status updates for this booking (the server only admits the renter, owner, driver or an admin)
    useEffect(() => {
        if (!id) return;
        const socket = connectTrackingSocket();
        const join = () => socket.emit('join_booking_room', id);
        const onStatus = (payload: { bookingId?: string; status?: string; booking?: Booking }) => {
            if (payload.bookingId !== id) return;
            setBooking((prev) => {
                if (prev && payload.status && prev.status !== payload.status) {
                    toast.info(`Booking status: ${STATUS_CONFIG[payload.status]?.label ?? payload.status}`);
                }
                return payload.booking ?? prev;
            });
        };
        join();
        socket.on('connect', join);
        socket.on('booking:status_changed', onStatus);
        return () => {
            socket.off('connect', join);
            socket.off('booking:status_changed', onStatus);
            socket.emit('leave_booking_room', id);
        };
    }, [id]);

    // The renter's completion code exists once the equipment has been handed over
    useEffect(() => {
        if (!booking || !isRenter || !IN_USE.includes(booking.status)) {
            setRenterOtp(null);
            return;
        }
        nodeApi.get<{ otp: string }>(`/bookings/${booking.id}/completion-otp`)
            .then((r) => setRenterOtp(r.otp))
            .catch((e: unknown) => toast.error(errorMessage(e, 'Could not load the completion code')));
    }, [booking, isRenter]);

    // Refund details only exist for a paid booking that was cancelled or declined
    useEffect(() => {
        if (!booking || !['cancelled', 'rejected'].includes(booking.status) || !['paid', 'refunded'].includes(booking.paymentStatus ?? '')) return;
        razorpayApi.refundStatus(booking.id)
            .then((r) => setRefundInfo((r?.refund as RefundInfo) ?? null))
            .catch((e: unknown) => toast.error(errorMessage(e, 'Could not load refund status')));
    }, [booking]);

    const handleAction = async (action: Action) => {
        if (!booking) return;
        setActing(true);
        try {
            const { method, success } = ACTIONS[action];
            const updated = method === 'post'
                ? await nodeApi.post<Booking>(`/bookings/${booking.id}/${action}`, {})
                : await nodeApi.patch<Booking>(`/bookings/${booking.id}/${action}`, {});
            setBooking(updated);
            if (updated.completion_otp) setRenterOtp(updated.completion_otp);
            toast.success(success);
        } catch (e: unknown) {
            toast.error(errorMessage(e, 'Action failed'));
        } finally {
            setActing(false);
        }
    };

    const handleReview = async () => {
        try {
            await nodeApi.post('/reviews', { bookingId: id, rating, reviewText });
            toast.success('Review submitted — thank you!');
            setReviewed(true);
            setShowReview(false);
        } catch (e: unknown) {
            toast.error(errorMessage(e, 'Failed to submit review'));
        }
    };

    const handleRefundRequest = async () => {
        setRequestingRefund(true);
        try {
            await razorpayApi.refund(id);
            const status = await razorpayApi.refundStatus(id);
            setRefundInfo((status?.refund as RefundInfo) ?? { status: 'refunded' });
            toast.success('Refund initiated — expect 5-7 business days');
        } catch (e: unknown) {
            toast.error(errorMessage(e, 'Refund failed — contact support'));
        } finally {
            setRequestingRefund(false);
        }
    };

    const handleWorkComplete = async () => {
        if (completionOtp.length !== 6) { toast.error("Enter the 6-digit code from the renter's booking page"); return; }
        setCompletingWork(true);
        try {
            const updated = await nodeApi.post<Booking>(`/bookings/${id}/complete`, { otp: completionOtp });
            setBooking(updated);
            setShowCompletionOtp(false);
            setCompletionOtp('');
            toast.success('Rental completed');
        } catch (e: unknown) {
            toast.error(errorMessage(e, 'Invalid code — check with the renter'));
        } finally {
            setCompletingWork(false);
        }
    };

    const repeatBooking = () => {
        const mid = booking?.machine?.id ?? booking?.machineId;
        if (mid) router.push(`/book/${mid}`);
        else toast.error('Equipment no longer available');
    };

    const shareWhatsApp = () => {
        if (!booking) return;
        const msg = [
            `🚜 FarmRent Booking Update`,
            `Equipment: ${booking.machine?.name ?? 'Equipment'}`,
            `Status: ${STATUS_CONFIG[booking.status]?.label ?? booking.status}`,
            `Dates: ${formatDate(booking.startDate)} → ${formatDate(booking.endDate)}`,
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
    const bookingId  = booking.id;
    const isClosed   = ['cancelled', 'rejected'].includes(booking.status);
    const canRetryRefund = isRenter && isClosed && booking.paymentStatus === 'paid' && refundInfo?.status !== 'refunded';

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            {/* Top bar */}
            <div className="bg-white border-b sticky top-0 z-10">
                <div className="container mx-auto px-4 py-3 max-w-2xl flex items-center justify-between">
                    <Link href={isOwner ? '/dashboard/owner' : '/bookings'} className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline">
                        <ChevronLeft className="h-4 w-4" /> {isOwner ? 'Owner Dashboard' : 'My Bookings'}
                    </Link>
                    <button type="button" onClick={shareWhatsApp} aria-label="Share booking on WhatsApp" className="p-2 rounded-xl hover:bg-gray-100 text-gray-500">
                        <Share2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="container mx-auto px-4 max-w-2xl py-6 space-y-4">

                {['confirmed', 'in_progress', 'return_pending', 'completed'].includes(booking.status) && (
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
                            <p className="text-xs text-green-600 mt-1 font-semibold">✅ Payment received</p>
                        )}
                    </CardContent>
                </Card>

                {/* Renter: completion code to show the owner at return */}
                {isRenter && IN_USE.includes(booking.status) && renterOtp && (
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                        <CardContent className="p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <KeyRound className="h-4 w-4 text-green-700" />
                                <span className="font-bold text-green-800 text-sm">Completion Code</span>
                            </div>
                            <p className="text-xs text-green-700 mb-3">
                                Show this code to the equipment owner when you return the equipment. They need it to close the rental.
                            </p>
                            <div className="flex items-center justify-center bg-white rounded-xl border-2 border-green-300 py-4">
                                <span data-testid="completion-otp" className="text-4xl font-black font-mono tracking-[0.5rem] text-green-800">{renterOtp}</span>
                            </div>
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
                                        src={booking.machine.images?.[0] || FALLBACK_IMAGE}
                                        alt={booking.machine.name}
                                        className="w-full h-full object-cover"
                                        onError={e => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }}
                                    />
                                </div>
                                <div>
                                    <p className="font-bold text-gray-900">{booking.machine.name}</p>
                                    {booking.machine.type && <p className="text-xs text-gray-500 mt-0.5 capitalize">{booking.machine.type.replace(/-/g, ' ')}</p>}
                                    {booking.machine.location?.district && (
                                        <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                                            <MapPin className="h-3 w-3 text-green-600" />{booking.machine.location.district}
                                        </p>
                                    )}
                                    <Link
                                        href={`/equipment/${booking.machine.id ?? booking.machineId}`}
                                        className="text-xs text-green-700 underline mt-1.5 block"
                                    >
                                        View equipment →
                                    </Link>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Pickup location — shared by the server once the owner has accepted */}
                {booking.pickup && (
                    <PickupLocationReveal
                        lat={booking.pickup.lat}
                        lng={booking.pickup.lng}
                        address={booking.pickup.address}
                        landmark={booking.pickup.landmark ?? undefined}
                        equipmentName={booking.machine?.name ?? 'Equipment'}
                        ownerName={booking.owner?.name}
                        ownerPhone={booking.owner?.phone ?? undefined}
                        bookingId={bookingId}
                        canTrack={['confirmed', ...IN_USE].includes(booking.status)}
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
                                <span className="font-semibold">{formatDate(booking.startDate)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-green-600" /> End Date</span>
                                <span className="font-semibold">{formatDate(booking.endDate)}</span>
                            </div>
                            {booking.subtotal != null && (
                                <div className="flex justify-between text-gray-500">
                                    <span>Rental ({booking.totalDays} day{booking.totalDays !== 1 ? 's' : ''})</span>
                                    <span>{inr(booking.subtotal)}</span>
                                </div>
                            )}
                            {Number(booking.service_fee) > 0 && (
                                <div className="flex justify-between text-gray-500"><span>Service fee</span><span>{inr(booking.service_fee)}</span></div>
                            )}
                            {Number(booking.deposit_amount) > 0 && (
                                <div className="flex justify-between text-gray-500"><span>Security deposit</span><span>{inr(booking.deposit_amount)}</span></div>
                            )}
                            {Number(booking.delivery_charge) > 0 && (
                                <div className="flex justify-between text-amber-600"><span>Delivery charge</span><span>{inr(booking.delivery_charge)}</span></div>
                            )}
                            {Number(booking.discount_amount) > 0 && (
                                <div className="flex justify-between text-green-600"><span>Promo discount</span><span>−{inr(booking.discount_amount)}</span></div>
                            )}
                            {booking.delivery_mode === 'delivery' && booking.field_address && (
                                <div className="flex justify-between text-gray-500 gap-4"><span>Deliver to</span><span className="text-right">{booking.field_address}</span></div>
                            )}
                            {booking.paymentMethod === 'cod' && (
                                <div className="flex justify-between text-amber-700">
                                    <span>Payment Method</span>
                                    <span className="font-semibold">💵 Cash on Delivery</span>
                                </div>
                            )}
                            <div className="flex justify-between pt-2 border-t font-bold">
                                <span>{booking.paymentStatus === 'paid' ? 'Total Paid' : 'Total'}</span>
                                <span className="text-green-700 text-base">{inr(booking.totalAmount)}</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Track live location */}
                {['confirmed', ...IN_USE].includes(booking.status) && (
                    <Link href={`/tracking/${bookingId}`}>
                        <Button className="w-full bg-indigo-700 hover:bg-indigo-800 rounded-xl gap-2 font-bold">
                            <Navigation className="h-4 w-4" /> Track Live Location
                        </Button>
                    </Link>
                )}

                {/* Online payment happens only after the owner confirms — the server refuses an order before that */}
                {isRenter && booking.status === 'confirmed' && booking.paymentMethod !== 'cod' && booking.paymentStatus !== 'paid' && (
                    <Button
                        className="w-full bg-green-700 hover:bg-green-800 rounded-xl gap-2 font-bold"
                        disabled={paying}
                        onClick={() => startCheckout({
                            bookingId,
                            user: {
                                full_name: user?.name ?? '',
                                email: user?.email ?? '',
                                phone: (user as { phone?: string | null } | null)?.phone ?? '',
                            },
                            onSuccess: () => {
                                toast.success('Payment received');
                                loadBooking().catch((e: unknown) => toast.error(errorMessage(e, 'Could not refresh the booking')));
                            },
                        })}
                    >
                        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        {t('booking.payNow')} · {inr(booking.totalAmount)}
                    </Button>
                )}

                {/* ── Owner actions ── */}
                {isOwner && booking.status === 'pending' && (
                    <div className="flex gap-3">
                        <Button className="flex-1 bg-green-700 hover:bg-green-800 rounded-xl" onClick={() => handleAction('accept')} disabled={acting}>
                            {acting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            {t('booking.accept')}
                        </Button>
                        <Button variant="destructive" className="flex-1 rounded-xl" onClick={() => handleAction('reject')} disabled={acting}>
                            <XCircle className="h-4 w-4 mr-2" /> Decline
                        </Button>
                    </div>
                )}

                {isOwner && booking.status === 'confirmed' && (
                    <Button className="w-full bg-green-700 hover:bg-green-800 rounded-xl gap-2" onClick={() => handleAction('start')} disabled={acting}>
                        {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                        Hand Over Equipment (Start Rental)
                    </Button>
                )}

                {isOwner && IN_USE.includes(booking.status) && (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                            {!showCompletionOtp ? (
                                <Button className="w-full bg-green-700 hover:bg-green-800 rounded-xl gap-2" onClick={() => setShowCompletionOtp(true)}>
                                    <CheckCircle2 className="h-4 w-4" /> Equipment Returned — Complete Rental
                                </Button>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-1">
                                        <KeyRound className="h-4 w-4 text-green-700" />
                                        <h3 className="font-bold text-gray-800 text-sm">Enter the renter&apos;s completion code</h3>
                                    </div>
                                    <p className="text-xs text-gray-500">Ask the renter for the 6-digit code shown on their booking page.</p>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        aria-label="Completion code"
                                        placeholder="6-digit code"
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

                {/* ── Renter actions ── */}
                {isRenter && booking.status === 'in_progress' && (
                    <Button variant="outline" className="w-full border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-xl gap-2"
                        onClick={() => handleAction('return')} disabled={acting}>
                        {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                        I&apos;m Returning the Equipment
                    </Button>
                )}

                {(isRenter || isOwner) && ['pending', 'confirmed'].includes(booking.status) && (
                    <Button variant="outline" className="w-full border-red-300 text-red-600 hover:bg-red-50 rounded-xl"
                        onClick={() => handleAction('cancel')} disabled={acting}>
                        {t('booking.cancelBooking')}
                    </Button>
                )}

                {isRenter && booking.status === 'completed' && (
                    <Button variant="outline" className="w-full border-green-300 text-green-700 hover:bg-green-50 rounded-xl gap-2 font-bold"
                        onClick={repeatBooking}>
                        <RotateCcw className="h-4 w-4" /> Book Again (Same Equipment)
                    </Button>
                )}

                {/* Review */}
                {isRenter && booking.status === 'completed' && !reviewed && (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="p-5">
                            {!showReview ? (
                                <Button className="w-full bg-yellow-500 hover:bg-yellow-600 rounded-xl gap-2 font-bold text-white"
                                    onClick={() => setShowReview(true)}>
                                    <Star className="h-4 w-4" /> Rate &amp; Review
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
                    <div className="text-center text-green-700 font-semibold py-2 text-sm">✅ Review submitted</div>
                )}

                {/* Refund: issued automatically on cancellation; this retries if the gateway failed then */}
                {canRetryRefund && (
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
                                    : 'Refund initiated'}
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
                {!isClosed && <BookingChat bookingId={id} />}

                {/* Invoice download */}
                {booking.status === 'completed' && (
                    <Button variant="outline" className="w-full rounded-xl gap-2"
                        disabled={downloadingInvoice}
                        onClick={async () => {
                            setDownloadingInvoice(true);
                            try { await invoicesApi.download(id); }
                            catch (e: unknown) { toast.error(errorMessage(e, 'Invoice download failed')); }
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

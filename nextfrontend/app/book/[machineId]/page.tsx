'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    IndianRupee, Calendar, CheckCircle2, CreditCard,
    ChevronLeft, Loader2, AlertCircle, MapPin, Info,
    Truck, Store, Tag, X, Bike, Banknote,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';
import { getMachineId, type Machine as BaseMachine } from '@/lib/getMachineId';
import { useRazorpay } from '@/hooks/useRazorpay';
import { useLanguage } from '@/context/LanguageContext';

interface Machine extends BaseMachine {
    type: string;
    images?: string[];
    location?: { district?: string; state?: string };
    pricing?: { baseRatePerDay?: number; baseRatePerHour?: number; securityDeposit?: number };
}
interface BookedRange { start_date: string; end_date: string; status: string }

type Step = 1 | 2;
type Gateway = 'razorpay' | 'cod';
type DeliveryMode = 'pickup' | 'delivery';

const DELIVERY_CHARGE = 500;

const toDate = (s: string) => new Date(s + 'T00:00:00');
const todayStr = () => new Date().toISOString().split('T')[0];
const diffDays = (a: string, b: string) =>
    Math.max(1, Math.ceil((toDate(b).getTime() - toDate(a).getTime()) / 86400000));

const isOverlap = (s: string, e: string, ranges: BookedRange[]) =>
    ranges.some(r => toDate(s) < new Date(r.end_date) && toDate(e) > new Date(r.start_date));

export default function BookPage() {
    const { machineId } = useParams<{ machineId: string }>();
    const router = useRouter();
    const { t } = useLanguage();

    const [machine, setMachine] = useState<Machine | null>(null);
    const [loading, setLoading] = useState(true);
    const [booked, setBooked] = useState<BookedRange[]>([]);
    const [step, setStep] = useState<Step>(1);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [gateway, setGateway] = useState<Gateway>('razorpay');
    const [submitting, setSubmitting] = useState(false);
    const [bookingId, setBookingId] = useState<string | null>(null);

    // Delivery mode
    const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('pickup');
    const [fieldAddress, setFieldAddress] = useState('');

    // Promo code
    const [promoCode, setPromoCode] = useState('');
    const [promoApplied, setPromoApplied] = useState(false);
    const [promoDiscount, setPromoDiscount] = useState(0);
    const [promoLabel, setPromoLabel] = useState('');
    const [promoLoading, setPromoLoading] = useState(false);

    const { startCheckout } = useRazorpay();

    useEffect(() => {
        if (!machineId) return;
        Promise.all([
            nodeApi.get<any>(`/machines/${machineId}`),
            nodeApi.get<any>(`/bookings/availability/${machineId}`).catch(() => ({ data: [] })),
        ]).then(([mRes, aRes]) => {
            setMachine(mRes?.data ?? mRes?.machine ?? mRes);
            const raw = aRes?.data ?? aRes;
            setBooked(Array.isArray(raw) ? raw : []);
        }).catch(() => toast.error('Could not load machine'))
            .finally(() => setLoading(false));
    }, [machineId]);

    const totalDays    = startDate && endDate ? diffDays(startDate, endDate) : 0;
    const rentalCost   = totalDays * (machine?.pricing?.baseRatePerDay ?? 0);
    const serviceFee   = Math.round(rentalCost * 0.03);
    const depositAmt   = machine?.pricing?.securityDeposit ?? 0;
    const deliveryAmt  = deliveryMode === 'delivery' ? DELIVERY_CHARGE : 0;
    const totalAmount  = Math.max(0, rentalCost + serviceFee + depositAmt + deliveryAmt - promoDiscount);

    const dateConflict = startDate && endDate ? isOverlap(startDate, endDate, booked) : false;

    /* ── Promo code validation ── */
    const handleApplyPromo = async () => {
        const code = promoCode.trim().toUpperCase();
        if (!code) { toast.error('Enter a promo code'); return; }
        if (!startDate || !endDate) { toast.error('Select dates first to apply a promo'); return; }
        setPromoLoading(true);
        try {
            const res: any = await nodeApi.post('/bookings/promo/validate', {
                code,
                amount: rentalCost,
            });
            const discount = res?.discount ?? res?.data?.discount ?? 0;
            const label    = res?.label ?? res?.data?.label ?? `${code} applied`;
            setPromoDiscount(discount);
            setPromoApplied(true);
            setPromoLabel(label);
            toast.success(`Promo applied! You save ₹${discount}`);
        } catch (e: any) {
            const msg = e?.message ?? 'Invalid or expired promo code';
            toast.error(msg);
        } finally {
            setPromoLoading(false);
        }
    };

    const clearPromo = () => {
        setPromoCode('');
        setPromoApplied(false);
        setPromoDiscount(0);
        setPromoLabel('');
    };

    /* ── Step 2: create booking ── */
    const handleStep2 = async () => {
        if (deliveryMode === 'delivery' && !fieldAddress.trim()) {
            toast.error('Enter your field/delivery address to continue');
            return;
        }
        setSubmitting(true);
        try {
            const normalizedId = getMachineId(machine);
            if (!normalizedId) {
                toast.error('Machine ID is missing. Please go back and try again.');
                return;
            }
            const res: any = await nodeApi.post('/bookings', {
                machineId: normalizedId,
                startDate,
                endDate,
                totalAmount,
                paymentMethod: gateway,
                deliveryMode,
                fieldAddress: deliveryMode === 'delivery' ? fieldAddress.trim() : undefined,
                promoCode: promoApplied ? promoCode.trim().toUpperCase() : undefined,
                promoDiscount: promoApplied ? promoDiscount : 0,
            });
            const extractedId = res?.data?._id ?? res?._id ?? res?.data?.id;
            if (!extractedId) {
                toast.error('Failed to create booking. Please try again.');
                setStep(1);
                return;
            }
            setBookingId(extractedId);
            setStep(2);
        } catch (e: any) {
            const msg = e?.message || 'Failed to create booking';
            if (String(msg).toLowerCase().includes('unauthorized')) {
                toast.error('Please login to book equipment');
                const next = `/book/${encodeURIComponent(String(machineId))}`;
                router.push(`/login?next=${encodeURIComponent(next)}`);
            } else {
                toast.error(msg);
            }
            setStep(1);
        } finally {
            setSubmitting(false);
        }
    };

    /* ── Step 3: Payment (Razorpay or COD) ── */
    const handlePayment = async () => {
        setSubmitting(true);
        try {
            // Cash on Delivery — no payment gateway needed
            if (gateway === 'cod') {
                toast.success('Booking confirmed! Pay when equipment arrives.');
                router.push(`/payment/success?bookingId=${encodeURIComponent(bookingId ?? '')}&method=cod`);
                return;
            }

            // Online payment via Razorpay
            const user = {
                full_name: (typeof window !== 'undefined' && localStorage.getItem('full_name')) || 'Farmer',
                email:     (typeof window !== 'undefined' && localStorage.getItem('email'))     || 'farmer@example.com',
                phone:     (typeof window !== 'undefined' && localStorage.getItem('phone'))     || '',
            };
            await startCheckout({
                amountInInr: totalAmount,
                user,
                receipt: bookingId ?? undefined,
                notes: { bookingId: bookingId ?? '' },
                onCancelled: () => { toast.error('Payment cancelled'); },
                onSuccess: (orderId) => {
                    router.push(`/payment/success?orderId=${encodeURIComponent(orderId)}`);
                },
            });
        } finally {
            setSubmitting(false);
        }
    };

    const upcomingConflicts = booked.filter(b => {
        const d = new Date(b.end_date);
        return !isNaN(d.getTime()) && d >= new Date();
    }).slice(0, 3);

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin text-green-700" />
        </div>
    );
    if (!machine) return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-xl">Machine not found.</p>
            <Link href="/browse"><Button variant="outline">Back to Browse</Button></Link>
        </div>
    );

    const steps = [t('booking.confirmBooking'), t('booking.payNow')];

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="container mx-auto px-4 max-w-2xl">
                <Link href={`/equipment/${machineId}`} className="inline-flex items-center gap-1 text-sm text-green-700 hover:underline mb-6">
                    <ChevronLeft className="h-4 w-4" /> {t('booking.backToEquipment')}
                </Link>

                {/* Step indicators */}
                <div className="flex items-center gap-2 mb-8">
                    {steps.map((label, i) => {
                        const s = (i + 1) as Step;
                        const done = step > s; const active = step === s;
                        return (
                            <div key={s} className="flex items-center gap-2 flex-1">
                                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all
                                    ${done ? 'bg-green-700 text-white' : active ? 'bg-green-700 text-white ring-4 ring-green-200' : 'bg-gray-200 text-gray-500'}`}>
                                    {done ? <CheckCircle2 className="h-4 w-4" /> : s}
                                </div>
                                <span className={`text-xs hidden sm:block ${active ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>{label}</span>
                                {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${done ? 'bg-green-700' : 'bg-gray-200'}`} />}
                            </div>
                        );
                    })}
                </div>

                <Card className="shadow-lg border-0">
                    <CardContent className="p-6 md:p-8">
                        {/* Machine header */}
                        <div className="flex gap-4 mb-6 pb-6 border-b">
                            <div className="w-20 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                                <img
                                    src={machine.images?.[0] || 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200'}
                                    alt={machine.name}
                                    className="w-full h-full object-cover"
                                    onError={e => { (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1560493676-04071c5f467b?w=200'; }}
                                />
                            </div>
                            <div>
                                <h2 className="font-bold text-lg">{machine.name}</h2>
                                <div className="flex items-center gap-1 text-sm text-gray-500">
                                    <MapPin className="h-3 w-3" />
                                    {[machine.location?.district, machine.location?.state].filter(Boolean).join(', ')}
                                </div>
                                <Badge className="mt-1 text-xs bg-green-100 text-green-700 border-0 capitalize">{machine.type?.replace(/-/g, ' ')}</Badge>
                            </div>
                        </div>

                        {/* ── Step 1: Dates + Delivery + Promo ── */}
                        {step === 1 && (
                            <div className="space-y-6">

                                {/* Date pickers */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="start-date" className="block text-sm font-semibold mb-2">
                                            <Calendar className="h-4 w-4 inline mr-1" /> {t('booking.startDate')}
                                        </label>
                                        <input
                                            type="date"
                                            id="start-date"
                                            suppressHydrationWarning
                                            min={todayStr()}
                                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-600 outline-none"
                                            value={startDate}
                                            onChange={e => {
                                                setStartDate(e.target.value);
                                                if (endDate && endDate < e.target.value) setEndDate('');
                                                clearPromo();
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="end-date" className="block text-sm font-semibold mb-2">
                                            <Calendar className="h-4 w-4 inline mr-1" /> {t('booking.endDate')}
                                        </label>
                                        <input
                                            type="date"
                                            id="end-date"
                                            suppressHydrationWarning
                                            min={startDate || todayStr()}
                                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-green-600 outline-none"
                                            value={endDate}
                                            onChange={e => { setEndDate(e.target.value); clearPromo(); }}
                                        />
                                    </div>
                                </div>

                                {upcomingConflicts.length > 0 && (
                                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                                        <p className="font-bold flex items-center gap-1 mb-1.5"><Info className="h-3 w-3" /> Already Booked Slots</p>
                                        {upcomingConflicts.map((r, i) => (
                                            <div key={i} className="flex justify-between items-center">
                                                <span>{new Date(r.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(r.end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">{r.status}</Badge>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {dateConflict && (
                                    <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm">
                                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                        {t('booking.datesOverlap')}
                                    </div>
                                )}

                                {/* ── Delivery mode ── */}
                                <div>
                                    <p className="text-sm font-semibold mb-2">How will you receive the equipment?</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setDeliveryMode('pickup')}
                                            className={`flex flex-col items-center gap-1.5 border-2 rounded-2xl p-4 transition-all text-sm font-semibold ${
                                                deliveryMode === 'pickup'
                                                    ? 'border-green-600 bg-green-50 text-green-800'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                            }`}
                                        >
                                            <Store className={`h-6 w-6 ${deliveryMode === 'pickup' ? 'text-green-700' : 'text-gray-400'}`} />
                                            <span>Self-Pickup</span>
                                            <span className="text-[10px] font-normal text-gray-500">Pick up from owner's yard</span>
                                            <span className="text-[10px] font-bold text-green-700">Free</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDeliveryMode('delivery')}
                                            className={`flex flex-col items-center gap-1.5 border-2 rounded-2xl p-4 transition-all text-sm font-semibold ${
                                                deliveryMode === 'delivery'
                                                    ? 'border-green-600 bg-green-50 text-green-800'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                            }`}
                                        >
                                            <Truck className={`h-6 w-6 ${deliveryMode === 'delivery' ? 'text-green-700' : 'text-gray-400'}`} />
                                            <span>Delivery to Field</span>
                                            <span className="text-[10px] font-normal text-gray-500">Delivered to your location</span>
                                            <span className="text-[10px] font-bold text-amber-600">+₹{DELIVERY_CHARGE}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* ── Field/delivery address ── */}
                                {deliveryMode === 'delivery' && (
                                    <div>
                                        <label className="block text-sm font-semibold mb-2">
                                            <MapPin className="h-4 w-4 inline mr-1 text-green-700" /> Delivery Address / Field Location
                                        </label>
                                        <textarea
                                            rows={2}
                                            placeholder="e.g. Survey No. 45, Rampur Village, Near Water Tank, Nagpur Taluk"
                                            value={fieldAddress}
                                            onChange={e => setFieldAddress(e.target.value)}
                                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-green-600 outline-none placeholder:text-gray-400"
                                        />
                                        <p className="text-[10px] text-gray-400 mt-1">Your exact field location helps the owner plan delivery logistics.</p>
                                    </div>
                                )}

                                {/* ── Promo code ── */}
                                <div>
                                    <label className="block text-sm font-semibold mb-2">
                                        <Tag className="h-4 w-4 inline mr-1 text-green-700" /> Promo Code
                                    </label>
                                    {promoApplied ? (
                                        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
                                            <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-green-800">{promoLabel}</p>
                                                <p className="text-xs text-green-600">You save ₹{promoDiscount.toLocaleString('en-IN')}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={clearPromo}
                                                className="text-gray-400 hover:text-red-500 transition-colors"
                                                aria-label="Remove promo code"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                placeholder="Enter promo code (e.g. FARM100)"
                                                value={promoCode}
                                                onChange={e => setPromoCode(e.target.value.toUpperCase())}
                                                onKeyDown={e => { if (e.key === 'Enter') handleApplyPromo(); }}
                                                className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm uppercase placeholder:normal-case placeholder:text-gray-400 focus:ring-2 focus:ring-green-600 outline-none"
                                            />
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="rounded-xl px-4 border-green-600 text-green-700 hover:bg-green-50 h-auto"
                                                onClick={handleApplyPromo}
                                                disabled={promoLoading || !promoCode.trim()}
                                            >
                                                {promoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Apply'}
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {/* ── Cost breakdown ── */}
                                <div className="bg-gray-50 rounded-2xl p-4 border border-dashed border-gray-200">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">{t('booking.costBreakdown')}</h3>
                                    {!startDate || !endDate ? (
                                        <p className="text-gray-400 text-xs italic text-center py-6">{t('booking.selectDatesToSeePrice')}</p>
                                    ) : (
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between">
                                                <span className="text-gray-600">{t('booking.duration')}</span>
                                                <span className="font-medium">{totalDays} days</span>
                                            </div>
                                            <div className="flex justify-between text-gray-500">
                                                <span>{t('booking.rentalCost')}</span>
                                                <span>₹{rentalCost.toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="flex justify-between text-gray-500">
                                                <span>{t('booking.serviceFee')} (3%)</span>
                                                <span>₹{serviceFee.toLocaleString('en-IN')}</span>
                                            </div>
                                            {depositAmt > 0 && (
                                                <div className="flex justify-between text-gray-500">
                                                    <span>Security Deposit</span>
                                                    <span>₹{depositAmt.toLocaleString('en-IN')}</span>
                                                </div>
                                            )}
                                            {deliveryMode === 'delivery' && (
                                                <div className="flex justify-between text-amber-600">
                                                    <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> Delivery Charge</span>
                                                    <span>₹{DELIVERY_CHARGE.toLocaleString('en-IN')}</span>
                                                </div>
                                            )}
                                            {promoApplied && promoDiscount > 0 && (
                                                <div className="flex justify-between text-green-600">
                                                    <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> Promo Discount</span>
                                                    <span>−₹{promoDiscount.toLocaleString('en-IN')}</span>
                                                </div>
                                            )}
                                            <div className="flex justify-between font-bold pt-2 border-t mt-1 text-base text-green-700">
                                                <span>{t('booking.total')}</span>
                                                <span>₹{totalAmount.toLocaleString('en-IN')}</span>
                                            </div>
                                            {depositAmt > 0 && (
                                                <p className="text-[10px] text-gray-400">* Deposit of ₹{depositAmt.toLocaleString('en-IN')} refunded after equipment return</p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* ── Payment Method ── */}
                                <div>
                                    <p className="text-sm font-semibold mb-2">How will you pay?</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setGateway('razorpay')}
                                            className={`flex flex-col items-center gap-1.5 border-2 rounded-2xl p-4 transition-all text-sm font-semibold ${
                                                gateway === 'razorpay'
                                                    ? 'border-green-600 bg-green-50 text-green-800'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                            }`}
                                        >
                                            <CreditCard className={`h-6 w-6 ${gateway === 'razorpay' ? 'text-green-700' : 'text-gray-400'}`} />
                                            <span>Online Payment</span>
                                            <span className="text-[10px] font-normal text-gray-500">UPI, Card, Netbanking</span>
                                            <span className="text-[10px] font-bold text-green-700">Instant confirm</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setGateway('cod')}
                                            className={`flex flex-col items-center gap-1.5 border-2 rounded-2xl p-4 transition-all text-sm font-semibold ${
                                                gateway === 'cod'
                                                    ? 'border-amber-500 bg-amber-50 text-amber-800'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                            }`}
                                        >
                                            <Banknote className={`h-6 w-6 ${gateway === 'cod' ? 'text-amber-600' : 'text-gray-400'}`} />
                                            <span>Cash on Delivery</span>
                                            <span className="text-[10px] font-normal text-gray-500">Pay when equipment arrives</span>
                                            <span className="text-[10px] font-bold text-amber-600">No advance needed</span>
                                        </button>
                                    </div>
                                </div>

                                <Button
                                    className="w-full bg-green-700 hover:bg-green-800 rounded-2xl py-6 text-base font-bold shadow-md"
                                    onClick={handleStep2}
                                    disabled={dateConflict || !startDate || !endDate || submitting}
                                >
                                    {submitting
                                        ? <><Loader2 className="h-5 w-5 animate-spin mr-2" /> Creating Booking…</>
                                        : <><CheckCircle2 className="mr-2" /> Confirm & Proceed to Pay</>
                                    }
                                </Button>
                            </div>
                        )}

                        {/* ── Step 2: Payment ── */}
                        {step === 2 && (
                            <div className="space-y-6">
                                <div className="text-center">
                                    <div className="inline-flex items-center justify-center bg-green-100 rounded-full w-16 h-16 mb-4">
                                        <CreditCard className="h-8 w-8 text-green-700" />
                                    </div>
                                    <h3 className="font-bold text-xl mb-1">{t('booking.completePayment')}</h3>
                                    <p className="text-gray-500 text-sm">{t('booking.slotHeld')}</p>
                                </div>

                                {/* Order summary pill */}
                                <div className="bg-gray-50 rounded-2xl p-4 space-y-2 text-sm">
                                    <div className="flex justify-between text-gray-600">
                                        <span>Rental ({totalDays} day{totalDays !== 1 ? 's' : ''})</span>
                                        <span>₹{rentalCost.toLocaleString('en-IN')}</span>
                                    </div>
                                    <div className="flex justify-between text-gray-600">
                                        <span>Service fee</span>
                                        <span>₹{serviceFee.toLocaleString('en-IN')}</span>
                                    </div>
                                    {depositAmt > 0 && (
                                        <div className="flex justify-between text-gray-600">
                                            <span>Security deposit</span>
                                            <span>₹{depositAmt.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                    {deliveryMode === 'delivery' && (
                                        <div className="flex justify-between text-amber-600">
                                            <span>Delivery charge</span>
                                            <span>₹{DELIVERY_CHARGE.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                    {promoApplied && promoDiscount > 0 && (
                                        <div className="flex justify-between text-green-600">
                                            <span>Promo discount</span>
                                            <span>−₹{promoDiscount.toLocaleString('en-IN')}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between font-bold text-base text-green-700 pt-2 border-t">
                                        <span>Total</span>
                                        <span className="flex items-center gap-0.5">
                                            <IndianRupee className="h-4 w-4" />{totalAmount.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>

                                {deliveryMode === 'delivery' && fieldAddress && (
                                    <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
                                        <Truck className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                        <span><strong>Delivery to:</strong> {fieldAddress}</span>
                                    </div>
                                )}

                                {gateway === 'cod' ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center space-y-2">
                                        <Banknote className="h-8 w-8 text-amber-600 mx-auto" />
                                        <p className="font-bold text-amber-800">Cash on Delivery Selected</p>
                                        <p className="text-sm text-amber-700">Pay ₹{totalAmount.toLocaleString('en-IN')} in cash when the equipment arrives at your location.</p>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-gray-600">
                                        <span className="text-lg">🇮🇳</span> Paying via Razorpay (UPI / Card / Netbanking)
                                    </div>
                                )}

                                <Button
                                    className={`w-full rounded-2xl py-6 text-base font-bold ${
                                        gateway === 'cod'
                                            ? 'bg-amber-500 hover:bg-amber-600'
                                            : 'bg-green-700 hover:bg-green-800'
                                    }`}
                                    onClick={handlePayment}
                                    disabled={submitting}
                                >
                                    {submitting
                                        ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing…</>
                                        : gateway === 'cod'
                                            ? <><Banknote className="mr-2 h-5 w-5" /> Confirm Booking — Pay on Delivery</>
                                            : <><CreditCard className="mr-2 h-5 w-5" /> Pay ₹{totalAmount.toLocaleString('en-IN')} Online</>
                                    }
                                </Button>

                                <button
                                    type="button"
                                    onClick={() => setStep(1)}
                                    className="w-full text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2"
                                >
                                    ← Go back and change payment method
                                </button>

                                <p className="text-xs text-center text-gray-400">
                                    {gateway === 'cod'
                                        ? '💵 No advance payment required · Pay when equipment arrives'
                                        : '🔒 Secured by Razorpay · 256-bit encryption'}
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

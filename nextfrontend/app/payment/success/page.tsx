'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, Home, List, Banknote } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

type PaymentRow = {
  razorpay_order_id: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  amount_paise: number;
  currency: string;
  paid_at?: string | null;
  error_description?: string | null;
};

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-green-700" />
      </div>
    }>
      <PaymentSuccessInner />
    </Suspense>
  );
}

function PaymentSuccessInner() {
  const { t } = useLanguage();
  const sp = useSearchParams();
  const orderId  = sp.get('orderId') ?? '';
  const method   = sp.get('method') ?? '';
  const bookingId = sp.get('bookingId') ?? '';
  const isCod    = method === 'cod';

  const [loading, setLoading]   = useState(!isCod);
  const [row, setRow]           = useState<PaymentRow | null>(null);
  const [errMsg, setErrMsg]     = useState('');
  const [retries, setRetries]   = useState(0);

  // COD — skip payment status lookup entirely
  if (isCod) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-10 px-4">
        <div className="w-full max-w-md">
          <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
            <CardContent className="p-0">
              <div className="px-6 py-8 text-center bg-amber-50">
                <div className="flex items-center justify-center mb-4">
                  <div className="bg-amber-100 rounded-full p-4">
                    <Banknote className="h-14 w-14 text-amber-600" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-amber-800">Booking Confirmed!</p>
                <p className="text-sm text-amber-700 mt-2">Pay in cash when the equipment arrives at your location.</p>
              </div>
              <div className="px-6 py-4 space-y-2 border-t bg-white text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Payment Method</span>
                  <span className="font-semibold text-amber-700">Cash on Delivery</span>
                </div>
                {bookingId && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Booking ID</span>
                    <span className="font-mono text-xs text-gray-700 truncate max-w-[60%] text-right">{bookingId}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className="font-semibold text-green-700">Pending Owner Confirmation</span>
                </div>
              </div>
              <div className="px-6 py-5 bg-white border-t flex gap-3">
                <Link href="/bookings" className="flex-1">
                  <Button className="w-full bg-green-700 hover:bg-green-800 gap-2">
                    <List className="h-4 w-4" /> My Bookings
                  </Button>
                </Link>
                <Link href="/" className="flex-1">
                  <Button variant="outline" className="w-full gap-2">
                    <Home className="h-4 w-4" /> Home
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!orderId) {
      setErrMsg('No order ID found in the URL.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const fetchStatus = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        const res = await fetch(`/api/payment/status?orderId=${encodeURIComponent(orderId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }

        const data: PaymentRow = await res.json();
        if (cancelled) return;
        setRow(data);
        setErrMsg('');

        // If still pending, poll again after 3 seconds (up to 5 times)
        if (data.status === 'pending' && retries < 5) {
          timer = setTimeout(() => setRetries(r => r + 1), 3000);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Could not load payment status.';
        // For mock orders the endpoint always succeeds — a real error means real problem
        setErrMsg(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchStatus();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, retries]);

  const isPaid      = row?.status === 'paid';
  const isFailed    = row?.status === 'failed' || row?.status === 'cancelled';
  const amountInr   = row?.amount_paise ? (row.amount_paise / 100).toLocaleString('en-IN') : null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-10 px-4">
      <div className="w-full max-w-md">
        <Card className="border-0 shadow-lg rounded-2xl overflow-hidden">
          <CardContent className="p-0">

            {/* ── Status banner ── */}
            <div className={`px-6 py-8 text-center ${
              loading           ? 'bg-gray-100'
              : isPaid          ? 'bg-green-50'
              : isFailed        ? 'bg-red-50'
              : errMsg          ? 'bg-amber-50'
              : 'bg-gray-50'
            }`}>
              {loading ? (
                <>
                  <Loader2 className="h-14 w-14 animate-spin text-green-700 mx-auto mb-4" />
                  <p className="text-gray-600 font-medium">{t('payment.confirming')}</p>
                  {retries > 0 && (
                    <p className="text-xs text-gray-400 mt-1">{t('payment.checkingAgain', { retries: String(retries) })}</p>
                  )}
                </>
              ) : errMsg ? (
                <>
                  <XCircle className="h-14 w-14 text-amber-500 mx-auto mb-4" />
                  <p className="text-lg font-bold text-amber-700">{t('payment.statusUnavailable')}</p>
                  <p className="text-sm text-amber-600 mt-1">{errMsg}</p>
                </>
              ) : isPaid ? (
                <>
                  <div className="flex items-center justify-center mb-4">
                    <div className="bg-green-100 rounded-full p-4">
                      <CheckCircle2 className="h-14 w-14 text-green-700" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-green-800">{t('payment.success')}</p>
                </>
              ) : (
                <>
                  <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
                  <p className="text-2xl font-bold text-red-700 capitalize">{row?.status ?? 'Unknown'}</p>
                  {row?.error_description && (
                    <p className="text-sm text-red-600 mt-1">{row.error_description}</p>
                  )}
                </>
              )}
            </div>

            {/* ── Details ── */}
            {!loading && row && (
              <div className="px-6 py-4 space-y-2 border-t bg-white text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">{t('payment.orderId')}</span>
                  <span className="font-mono text-xs text-gray-700 truncate max-w-[60%] text-right">{orderId}</span>
                </div>
                {amountInr && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('payment.amount')}</span>
                    <span className="font-semibold text-green-700">₹{amountInr} {row.currency}</span>
                  </div>
                )}
                {row.paid_at && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">{t('payment.paidAt')}</span>
                    <span className="text-gray-700">{new Date(row.paid_at).toLocaleString('en-IN')}</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Actions ── */}
            {!loading && (
              <div className="px-6 py-5 bg-white border-t flex gap-3">
                <Link href="/bookings" className="flex-1">
                  <Button className="w-full bg-green-700 hover:bg-green-800 gap-2">
                    <List className="h-4 w-4" /> {t('booking.myBookings')}
                  </Button>
                </Link>
                <Link href="/" className="flex-1">
                  <Button variant="outline" className="w-full gap-2">
                    <Home className="h-4 w-4" /> {t('nav.home')}
                  </Button>
                </Link>
              </div>
            )}

            {/* Refresh while pending or error */}
            {!loading && (errMsg || row?.status === 'pending') && (
              <div className="px-6 pb-5 bg-white flex justify-center">
                <Button variant="ghost" size="sm" onClick={() => { setLoading(true); setRetries(r => r + 1); }}>
                  {t('common.retry')}
                </Button>
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

declare global {
  interface Window {
    Razorpay?: any;
  }
}

type CreateOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

async function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.Razorpay) return;

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(script);
  });
}

export function useRazorpay() {
  const [loading, setLoading] = useState(false);

  const startCheckout = useCallback(
    async (args: {
      amountInInr: number;
      user: { full_name: string; email: string; phone: string };
      receipt?: string;
      notes?: Record<string, string>;
      onCancelled?: () => void;
      onSuccess?: (orderId: string) => void;
    }) => {
      setLoading(true);
      try {
        const res = await fetch('/api/payment/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: args.amountInInr,
            currency: 'INR',
            receipt: args.receipt,
            notes: args.notes,
          }),
        });
        if (!res.ok) {
          let msg = 'Payment setup failed. Please try again.';
          try {
            const j = (await res.json()) as { message?: string };
            if (j?.message) msg = j.message;
          } catch {
            // ignore json parsing
          }
          throw new Error(msg);
        }
        const data = (await res.json()) as CreateOrderResponse;

        // ── Razorpay checkout flow ────────────────────────────────────────────
        await loadRazorpayScript();
        if (!window.Razorpay) throw new Error('razorpay_not_loaded');

        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency,
          name: 'FarmRent',
          description: 'Equipment rental payment',
          order_id: data.orderId,
          prefill: {
            name: args.user.full_name,
            email: args.user.email,
            contact: args.user.phone,
          },
          theme: { color: '#16a34a' },
          method: {
            upi: true,
            card: true,
            netbanking: true,
            wallet: true,
            emi: false,
            paylater: false,
          },
          handler: async function (response: any) {
            try {
              const vr = await fetch('/api/payment/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response),
              });
              if (!vr.ok) throw new Error('verify_failed');
              args.onSuccess?.(data.orderId);
            } catch {
              toast.error('Payment could not be confirmed. Contact support.');
            }
          },
          modal: {
            ondismiss: function () {
              args.onCancelled?.();
            },
          },
        };

        const rz = new window.Razorpay(options);
        rz.open();
      } catch (e: unknown) {
        const msg = e instanceof Error && e.message ? e.message : 'Payment setup failed. Please try again.';
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { startCheckout, loading };
}


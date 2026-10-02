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
  amount: number; // paise, computed by the server from the booking
  currency: string;
  keyId: string;
};

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
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

/** POST to the payment API. The server requires an Idempotency-Key so a retried request cannot charge twice. */
async function postPayment<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message || json?.message || 'Payment request failed. Please try again.');
  }
  // Unwrap the standard { success, data, error } envelope.
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export function useRazorpay() {
  const [loading, setLoading] = useState(false);

  const startCheckout = useCallback(
    async (args: {
      bookingId: string;
      user: { full_name: string; email: string; phone: string };
      onCancelled?: () => void;
      onSuccess?: (orderId: string) => void;
    }) => {
      setLoading(true);
      try {
        // The amount is taken from the booking on the server; the client only identifies the booking.
        const order = await postPayment<CreateOrderResponse>(
          '/api/payment/create-order',
          { bookingId: args.bookingId },
          `order-${crypto.randomUUID()}`,
        );

        await loadRazorpayScript();
        if (!window.Razorpay) throw new Error('Could not load the payment window. Check your connection and try again.');

        const options = {
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          name: 'FarmRent',
          description: 'Equipment rental payment',
          order_id: order.orderId,
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
          handler: async (response: RazorpaySuccess) => {
            try {
              await postPayment('/api/payment/verify', response, `verify-${response.razorpay_payment_id}`);
              args.onSuccess?.(order.orderId);
            } catch (e: unknown) {
              toast.error(e instanceof Error ? e.message : 'Payment could not be confirmed. Contact support.');
            }
          },
          modal: {
            ondismiss: () => {
              args.onCancelled?.();
            },
          },
        };

        const rz = new window.Razorpay(options);
        rz.open();
      } catch (e: unknown) {
        toast.error(e instanceof Error && e.message ? e.message : 'Payment setup failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { startCheckout, loading };
}

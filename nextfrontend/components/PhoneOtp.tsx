'use client';

/**
 * Signing in and signing up with a mobile number.
 *
 * Two pieces, both shared by the login and register screens:
 *   OtpInput    six boxes that behave like one field — Android's SMS autofill delivers the whole code to
 *               the first one, so it has to spread a paste across all six rather than truncate to one digit.
 *   usePhoneOtp the request half: send, resend countdown, verify, and the plain-words errors the server
 *               already phrases ("Wrong OTP, 2 tries left", "Please wait 45 seconds to resend.").
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nodeApi, ApiError } from '@/lib/api';

export const OTP_LENGTH = 6;

/* ── Six boxes that behave like one field ─────────────────────────────────── */

export function OtpInput({
    value,
    onChange,
    onComplete,
    disabled,
    invalid,
    autoFocus,
}: {
    value: string;
    onChange: (next: string) => void;
    onComplete?: (code: string) => void;
    disabled?: boolean;
    invalid?: boolean;
    autoFocus?: boolean;
}) {
    const boxes = useRef<Array<HTMLInputElement | null>>([]);

    const setDigits = (next: string) => {
        const clean = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
        onChange(clean);
        if (clean.length === OTP_LENGTH) onComplete?.(clean);
        return clean;
    };

    const handleInput = (index: number, raw: string) => {
        // Android's SMS autofill hands the whole code to whichever box has focus, so anything longer than
        // one character is treated as the full code rather than a single digit.
        if (raw.length > 1) {
            const filled = setDigits(raw);
            boxes.current[Math.min(filled.length, OTP_LENGTH - 1)]?.focus();
            return;
        }
        const digit = raw.replace(/\D/g, '');
        if (!digit) return;
        const next = (value.slice(0, index) + digit + value.slice(index + 1)).slice(0, OTP_LENGTH);
        setDigits(next);
        if (index < OTP_LENGTH - 1) boxes.current[index + 1]?.focus();
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace') {
            e.preventDefault();
            if (value[index]) {
                onChange(value.slice(0, index) + value.slice(index + 1));
            } else if (index > 0) {
                onChange(value.slice(0, index - 1) + value.slice(index));
                boxes.current[index - 1]?.focus();
            }
            return;
        }
        if (e.key === 'ArrowLeft' && index > 0) boxes.current[index - 1]?.focus();
        if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) boxes.current[index + 1]?.focus();
    };

    return (
        <div className="flex gap-2 justify-between" dir="ltr">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <input
                    key={i}
                    ref={el => { boxes.current[i] = el; }}
                    // One field's worth of semantics, so Android offers the code from the SMS.
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={OTP_LENGTH}
                    aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
                    aria-invalid={!!invalid}
                    value={value[i] ?? ''}
                    disabled={disabled}
                    autoFocus={autoFocus && i === 0}
                    onChange={e => handleInput(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onPaste={e => {
                        e.preventDefault();
                        const filled = setDigits(e.clipboardData.getData('text'));
                        boxes.current[Math.min(filled.length, OTP_LENGTH - 1)]?.focus();
                    }}
                    className={`h-14 w-full min-w-0 rounded-xl border-2 text-center text-2xl font-bold tabular-nums
                        focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50
                        ${invalid ? 'border-red-500' : 'border-gray-300'}`}
                />
            ))}
        </div>
    );
}

/* ── The request half ─────────────────────────────────────────────────────── */

export type OtpPurpose = 'login' | 'signup';

interface SendResponse { ok: boolean; resendAfter: number; message?: string; devOtp?: string }

export function usePhoneOtp(purpose: OtpPurpose) {
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [devOtp, setDevOtp] = useState<string | null>(null);

    // One interval for the whole countdown, cleared on unmount so a navigation mid-countdown leaks nothing.
    useEffect(() => {
        if (secondsLeft <= 0) return;
        const id = setInterval(() => setSecondsLeft(s => (s <= 1 ? 0 : s - 1)), 1000);
        return () => clearInterval(id);
    }, [secondsLeft]);

    const send = useCallback(async (phone: string) => {
        setError('');
        setSending(true);
        try {
            const res = await nodeApi.post<SendResponse>('/auth/phone/send-otp', { phone, purpose });
            setSent(true);
            setSecondsLeft(res?.resendAfter ?? 60);
            setDevOtp(res?.devOtp ?? null);
            return true;
        } catch (err) {
            // The server already phrases these for a reader; the countdown comes back as a number.
            if (err instanceof ApiError && typeof err.details?.resendAfter === 'number') {
                setSecondsLeft(err.details.resendAfter as number);
                setSent(true);
            }
            setError(err instanceof Error ? err.message : 'Could not send the code. Please try again.');
            return false;
        } finally {
            setSending(false);
        }
    }, [purpose]);

    /** Resolves with the response body on success, or null when the code was refused. */
    const verify = useCallback(async <T,>(phone: string, otp: string): Promise<T | null> => {
        setError('');
        setVerifying(true);
        try {
            return await nodeApi.post<T>('/auth/phone/verify-otp', { phone, otp, purpose });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not check that code. Please try again.');
            return null;
        } finally {
            setVerifying(false);
        }
    }, [purpose]);

    const reset = useCallback(() => {
        setSent(false);
        setError('');
        setSecondsLeft(0);
        setDevOtp(null);
    }, []);

    return { send, verify, reset, sending, verifying, sent, error, setError, secondsLeft, devOtp };
}

/* ── The +91 number field, shared by both screens ─────────────────────────── */

export function PhoneField({
    value,
    onChange,
    disabled,
    invalid,
    id = 'phone',
}: {
    value: string;
    onChange: (next: string) => void;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
}) {
    return (
        <div
            className={`flex items-center rounded-xl overflow-hidden border-2 focus-within:ring-2 focus-within:ring-green-500
                ${invalid ? 'border-red-500' : 'border-gray-300'}`}
        >
            <span className="px-3 text-base font-semibold text-gray-700 border-r border-gray-300 bg-gray-100 h-12 flex items-center select-none">
                +91
            </span>
            <input
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="10-digit mobile number"
                maxLength={10}
                value={value}
                disabled={disabled}
                aria-invalid={!!invalid}
                onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="flex-1 min-w-0 px-3 text-base h-12 outline-none bg-transparent disabled:opacity-60"
            />
        </div>
    );
}

/** True for a number the backend will accept, so the button can stay disabled until then. */
export const isIndianMobile = (phone: string) => /^[6-9]\d{9}$/.test(phone);

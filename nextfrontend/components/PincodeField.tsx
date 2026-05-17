'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export interface PincodeResult {
    pincode: string;
    town: string;
    village: string;
    state: string;
}

interface Props {
    value?: string;
    onChange?: (val: string) => void;
    onResolved?: (result: PincodeResult) => void;
    label?: string;
    required?: boolean;
    className?: string;
    error?: string;
}

type Status = 'idle' | 'loading' | 'found' | 'invalid';

async function lookupPincode(pincode: string): Promise<PincodeResult | null> {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data[0]?.Status !== 'Success') return null;
    const offices: Array<{ Name: string; District: string; State: string; Division: string }> = data[0].PostOffice ?? [];
    if (!offices.length) return null;
    const first = offices[0];
    // Division = taluk/town level; District = district level
    const town    = first.Division || first.District;
    const village = first.Name.replace(/\s*(S\.?O\.?|B\.?O\.?|H\.?O\.?)\s*$/i, '').trim();
    return {
        pincode,
        state: first.State,
        town,
        village,
    };
}

export default function PincodeField({ value: valueProp, onChange, onResolved, label = 'PIN Code', required, className, error }: Props) {
    const [internalValue, setInternalValue] = useState('');
    const value = valueProp ?? internalValue;
    const [status, setStatus] = useState<Status>('idle');
    const [result, setResult] = useState<PincodeResult | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const lookup = useCallback(async (pin: string) => {
        if (!/^\d{6}$/.test(pin)) { setStatus('idle'); setResult(null); return; }
        setStatus('loading');
        try {
            const r = await lookupPincode(pin);
            if (r) {
                setResult(r);
                setStatus('found');
                onResolved?.(r);
            } else {
                setStatus('invalid');
                setResult(null);
            }
        } catch {
            setStatus('invalid');
            setResult(null);
        }
    }, [onResolved]);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (/^\d{6}$/.test(value)) {
            debounceRef.current = setTimeout(() => lookup(value), 400);
        } else {
            setStatus('idle');
            setResult(null);
        }
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [value, lookup]);

    const handleChange = (raw: string) => {
        const cleaned = raw.replace(/\D/g, '').slice(0, 6);
        if (valueProp === undefined) setInternalValue(cleaned);
        onChange?.(cleaned);
    };

    return (
        <div className={className}>
            <Label htmlFor="pincode-input" className="mb-1.5 block text-xs font-semibold text-gray-600">
                {label} {required && <span className="text-red-500">*</span>}
            </Label>
            <div className="relative">
                <Input
                    id="pincode-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit PIN code"
                    value={value}
                    onChange={e => handleChange(e.target.value)}
                    className={`h-10 rounded-xl text-sm pr-9 ${error ? 'border-red-400 focus-visible:ring-red-400' : ''}`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {status === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                    {status === 'found'   && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                    {status === 'invalid' && <XCircle className="h-4 w-4 text-red-500" />}
                </div>
            </div>

            {/* Feedback message */}
            {status === 'found' && result && (
                <p className="text-xs text-green-700 font-medium mt-1 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Location found: {result.town}, {result.state}
                </p>
            )}
            {status === 'invalid' && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Invalid PIN code — please check
                </p>
            )}
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}

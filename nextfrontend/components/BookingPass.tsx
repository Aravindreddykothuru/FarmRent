'use client';

import { CheckCircle2, MapPin, Share2, Printer, Calendar, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BookingPassProps {
    bookingId: string;
    equipmentName: string;
    farmerName: string;
    startDate: string;
    endDate: string;
    totalAmount: number;
    status: string;
    district?: string;
    ownerName?: string;
    paymentStatus?: string;
    equipmentType?: string;
}

const STATUS_COLOR: Record<string, string> = {
    confirmed:   'text-green-300',
    in_progress: 'text-blue-300',
    completed:   'text-gray-300',
    pending:     'text-yellow-300',
    cancelled:   'text-red-300',
};

const STATUS_LABEL: Record<string, string> = {
    confirmed:   'Confirmed',
    in_progress: 'In Progress',
    completed:   'Completed',
    pending:     'Pending',
    cancelled:   'Cancelled',
    requested:   'Requested',
};

export default function BookingPass({
    bookingId, equipmentName, farmerName, startDate, endDate,
    totalAmount, status, district, ownerName, paymentStatus, equipmentType,
}: BookingPassProps) {
    const origin  = typeof window !== 'undefined' ? window.location.origin : 'https://farmrent.in';
    const qrData  = `${origin}/bookings/${bookingId}`;
    const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrData)}&bgcolor=14532d&color=86efac&qzone=2`;
    const shortId = bookingId.slice(-8).toUpperCase();

    const fmt = (d: string) =>
        new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const shareWhatsApp = () => {
        const msg = [
            `🚜 *FarmRent Booking Confirmed!*`,
            ``,
            `*Equipment:* ${equipmentName}${equipmentType ? ` (${equipmentType})` : ''}`,
            district ? `*Location:* ${district}` : '',
            `*Dates:* ${fmt(startDate)} → ${fmt(endDate)}`,
            `*Amount:* ₹${totalAmount.toLocaleString('en-IN')}`,
            `*Booking ID:* #${shortId}`,
            ``,
            `View booking: ${origin}/bookings/${bookingId}`,
        ].filter(Boolean).join('\n');
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
    };

    return (
        <div>
            {/* ── mBooking Pass Card ─────────────────────────────────── */}
            <div className="bg-gradient-to-br from-green-950 via-green-900 to-green-800 rounded-2xl overflow-hidden shadow-xl print:shadow-none">

                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-4">
                    <div>
                        <p className="text-green-300 text-[11px] font-bold tracking-widest uppercase">🚜 FarmRent</p>
                        <p className="text-white font-black text-2xl leading-tight">mBooking Pass</p>
                    </div>
                    <div className="text-right">
                        <p className="text-green-400 text-[10px] uppercase tracking-wide">Booking ID</p>
                        <p className="text-white font-mono font-black text-sm bg-white/10 px-2 py-0.5 rounded-lg mt-0.5">#{shortId}</p>
                    </div>
                </div>

                {/* Equipment + QR */}
                <div className="flex gap-4 px-5 pb-4">
                    <div className="flex-1 min-w-0">
                        <p className="text-green-300 text-xs font-medium mb-1">Equipment</p>
                        <p className="text-white font-black text-lg leading-tight line-clamp-2 mb-3">{equipmentName}</p>
                        {district && (
                            <div className="flex items-center gap-1 text-green-300 text-xs mb-3">
                                <MapPin className="h-3 w-3 flex-shrink-0" />
                                <span>{district}</span>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                                <p className="text-green-400 text-[10px] uppercase tracking-wide">Farmer</p>
                                <p className="text-white text-sm font-semibold truncate">{farmerName}</p>
                            </div>
                            {ownerName && (
                                <div>
                                    <p className="text-green-400 text-[10px] uppercase tracking-wide">Owner</p>
                                    <p className="text-white text-sm font-semibold truncate">{ownerName}</p>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* QR Code */}
                    <div className="flex-shrink-0 bg-green-950 rounded-xl p-1.5 self-start border border-green-700/50">
                        <img
                            src={qrUrl}
                            alt={`QR code for booking ${bookingId}`}
                            width={100}
                            height={100}
                            className="rounded-lg block"
                            loading="lazy"
                        />
                        <p className="text-green-400 text-[9px] text-center mt-1 font-mono">Scan to verify</p>
                    </div>
                </div>

                {/* Tear-line */}
                <div className="relative px-4 py-1">
                    <div className="border-t border-dashed border-green-600/50" />
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-gray-50 dark:bg-gray-900 rounded-full -ml-2.5" />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-5 h-5 bg-gray-50 dark:bg-gray-900 rounded-full -mr-2.5" />
                </div>

                {/* Date + Amount strip */}
                <div className="grid grid-cols-3 gap-2 px-5 py-4">
                    <div>
                        <p className="text-green-400 text-[10px] uppercase flex items-center gap-1">
                            <Calendar className="h-2.5 w-2.5" /> From
                        </p>
                        <p className="text-white text-sm font-bold mt-0.5">{fmt(startDate)}</p>
                    </div>
                    <div>
                        <p className="text-green-400 text-[10px] uppercase">To</p>
                        <p className="text-white text-sm font-bold mt-0.5">{fmt(endDate)}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-green-400 text-[10px] uppercase flex items-center justify-end gap-0.5">
                            <IndianRupee className="h-2.5 w-2.5" /> Amount
                        </p>
                        <p className="text-white text-sm font-black mt-0.5">₹{totalAmount.toLocaleString('en-IN')}</p>
                    </div>
                </div>

                {/* Status footer */}
                <div className="bg-black/30 backdrop-blur px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                        <span className={`text-sm font-bold ${STATUS_COLOR[status] ?? 'text-white'}`}>
                            {STATUS_LABEL[status] ?? status}
                        </span>
                        {paymentStatus === 'paid' && (
                            <span className="text-[10px] bg-green-400/20 text-green-300 border border-green-500/30 px-2 py-0.5 rounded-full font-semibold">
                                Payment Confirmed ✓
                            </span>
                        )}
                    </div>
                    <p className="text-green-500 text-[11px] font-medium">Show QR at handover</p>
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs rounded-xl border-green-200 text-green-700 hover:bg-green-50"
                    onClick={shareWhatsApp}
                >
                    <Share2 className="h-3.5 w-3.5" />
                    Share on WhatsApp
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 text-xs rounded-xl"
                    onClick={() => window.print()}
                >
                    <Printer className="h-3.5 w-3.5" />
                    Print Pass
                </Button>
            </div>
        </div>
    );
}

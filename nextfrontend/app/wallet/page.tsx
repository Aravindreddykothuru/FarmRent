'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Wallet, Coins, ArrowDownLeft, ArrowUpRight, ChevronLeft,
    IndianRupee, TrendingUp, Gift, CircleHelp, CheckCircle2,
    RefreshCw, Clock,
} from 'lucide-react';
import { nodeApi } from '@/lib/api';
import { toast } from 'sonner';

interface Transaction {
    id: string;
    type: 'payment' | 'refund' | 'credit';
    amount: number;
    status: string;
    date: string;
    description: string;
    bookingId?: string;
    paymentId?: string;
}

interface WalletData {
    balance: number;
    farmCoins: number;
    coinValue: number;
    totalSpent: number;
    transactions: Transaction[];
    stats: { totalBookings: number; totalRefunds: number };
}

function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtAmt(n: number) {
    return n.toLocaleString('en-IN');
}

const TX_ICON: Record<string, React.ReactNode> = {
    payment: <ArrowUpRight className="h-4 w-4 text-red-500" />,
    refund:  <ArrowDownLeft className="h-4 w-4 text-green-600" />,
    credit:  <ArrowDownLeft className="h-4 w-4 text-green-600" />,
};

const STATUS_BADGE: Record<string, string> = {
    paid:     'bg-green-100 text-green-700',
    refunded: 'bg-blue-100 text-blue-700',
    pending:  'bg-amber-100 text-amber-700',
    failed:   'bg-red-100 text-red-700',
};

export default function WalletPage() {
    const [wallet,  setWallet]  = useState<WalletData | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab,     setTab]     = useState<'all' | 'payments' | 'refunds'>('all');

    useEffect(() => {
        nodeApi.get<{ wallet: WalletData }>('/users/wallet')
            .then(r => setWallet(r?.wallet ?? null))
            .catch(() => toast.error('Could not load wallet'))
            .finally(() => setLoading(false));
    }, []);

    const filtered = wallet?.transactions.filter(t => {
        if (tab === 'payments') return t.type === 'payment';
        if (tab === 'refunds')  return t.type === 'refund';
        return true;
    }) ?? [];

    return (
        <div className="min-h-screen bg-[#F7F8FA]">

            {/* Header */}
            <div className="bg-gradient-to-br from-green-900 via-green-800 to-emerald-700 text-white px-4 pt-6 pb-16">
                <div className="container mx-auto max-w-lg">
                    <Link href="/dashboard" className="inline-flex items-center gap-1 text-green-200 text-sm mb-5 hover:text-white">
                        <ChevronLeft className="h-4 w-4" /> Dashboard
                    </Link>
                    <div className="flex items-center gap-2 mb-6">
                        <div className="bg-white/15 rounded-xl p-2.5">
                            <Wallet className="h-5 w-5 text-white" />
                        </div>
                        <h1 className="text-xl font-black">FarmWallet</h1>
                    </div>

                    {/* Balance card */}
                    {loading ? (
                        <div className="bg-white/10 rounded-2xl p-5 animate-pulse h-32" />
                    ) : (
                        <div className="bg-white/10 backdrop-blur rounded-2xl p-5 border border-white/20">
                            <p className="text-green-200 text-xs font-semibold uppercase tracking-wide mb-1">Wallet Balance</p>
                            <div className="flex items-baseline gap-1 mb-4">
                                <IndianRupee className="h-6 w-6 text-white" />
                                <span className="text-4xl font-black text-white">{fmtAmt(wallet?.balance ?? 0)}</span>
                            </div>
                            <Button
                                className="w-full bg-white text-green-800 hover:bg-green-50 font-bold rounded-xl h-10"
                                onClick={() => toast.info('UPI top-up coming soon! Use Razorpay at checkout for now.')}
                            >
                                + Add Money via UPI
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            <div className="container mx-auto max-w-lg px-4 -mt-8 space-y-4 pb-16">

                {/* FarmCoins card */}
                {loading ? (
                    <Skeleton className="h-28 w-full rounded-2xl" />
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="bg-yellow-100 rounded-lg p-1.5">
                                        <Coins className="h-4 w-4 text-yellow-600" />
                                    </div>
                                    <span className="font-bold text-gray-800">FarmCoins</span>
                                    <span className="text-xs text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">Loyalty Points</span>
                                </div>
                                <div className="flex items-baseline gap-1.5 mt-2">
                                    <span className="text-3xl font-black text-yellow-600">{wallet?.farmCoins ?? 0}</span>
                                    <span className="text-sm text-gray-500">coins</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    ≈ ₹{wallet?.coinValue ?? 0} redemption value
                                </p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs rounded-xl border-yellow-200 text-yellow-700 hover:bg-yellow-50"
                                onClick={() => toast.info('Coin redemption at checkout — coming soon!')}
                            >
                                <Gift className="h-3.5 w-3.5 mr-1" /> Redeem
                            </Button>
                        </div>

                        {/* Earn tip */}
                        <div className="mt-3 bg-yellow-50 rounded-xl px-3 py-2 border border-yellow-100">
                            <p className="text-xs text-yellow-700 font-semibold">
                                🪙 Earn 1 FarmCoin per ₹100 spent · Redeem ₹1 per coin on future bookings
                            </p>
                        </div>
                    </div>
                )}

                {/* Stats row */}
                {!loading && wallet && (
                    <div className="grid grid-cols-3 gap-3">
                        {[
                            { icon: TrendingUp,  label: 'Total Spent',   value: `₹${fmtAmt(wallet.totalSpent)}`,    color: 'text-green-700' },
                            { icon: CheckCircle2, label: 'Bookings Paid', value: wallet.stats.totalBookings,          color: 'text-indigo-700' },
                            { icon: RefreshCw,   label: 'Refunds',       value: wallet.stats.totalRefunds,           color: 'text-blue-700' },
                        ].map(s => (
                            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
                                <s.icon className={`h-5 w-5 mx-auto mb-1.5 ${s.color}`} />
                                <p className={`text-lg font-black ${s.color}`}>{s.value}</p>
                                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{s.label}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Transaction history */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-50">
                        <h2 className="font-bold text-gray-900">Transaction History</h2>
                        <div className="flex gap-1">
                            {(['all', 'payments', 'refunds'] as const).map(t => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => setTab(t)}
                                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors capitalize ${
                                        tab === t ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="divide-y divide-gray-50">
                            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-none" />)}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-14 text-center">
                            <Clock className="h-10 w-10 mx-auto text-gray-200 mb-3" />
                            <p className="text-gray-500 font-semibold text-sm">No transactions yet</p>
                            <p className="text-gray-400 text-xs mt-1">Complete your first booking to see history</p>
                            <Link href="/browse" className="mt-4 inline-block">
                                <Button size="sm" className="bg-green-700 hover:bg-green-800 rounded-xl text-xs mt-2">Browse Equipment</Button>
                            </Link>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {filtered.map(tx => (
                                <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        tx.type === 'payment' ? 'bg-red-50' : 'bg-green-50'
                                    }`}>
                                        {TX_ICON[tx.type] ?? TX_ICON.payment}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-gray-900 truncate">{tx.description}</p>
                                        <p className="text-xs text-gray-400">{fmtDate(tx.date)}</p>
                                        {tx.bookingId && (
                                            <Link href={`/bookings/${tx.bookingId}`} className="text-[10px] text-green-700 hover:underline">
                                                View Booking →
                                            </Link>
                                        )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className={`text-sm font-bold ${tx.type === 'payment' ? 'text-gray-800' : 'text-green-600'}`}>
                                            {tx.type === 'payment' ? '−' : '+'}₹{fmtAmt(tx.amount)}
                                        </p>
                                        <Badge className={`text-[10px] border-0 px-1.5 ${STATUS_BADGE[tx.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                            {tx.status}
                                        </Badge>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* How to earn more */}
                <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-2xl border border-yellow-100 p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <CircleHelp className="h-4 w-4 text-yellow-600" />
                        <h3 className="font-bold text-gray-800 text-sm">How to earn more FarmCoins</h3>
                    </div>
                    <ul className="space-y-2">
                        {[
                            '🛒 Book equipment — earn 1 coin per ₹100 spent',
                            '⭐ Leave a review after rental — bonus 10 coins',
                            '👥 Refer a farmer — earn 50 coins per signup',
                            '📅 Book 7+ days in advance — double coins',
                        ].map(tip => (
                            <li key={tip} className="text-xs text-gray-600 flex items-start gap-2">
                                <span className="mt-0.5">{tip.slice(0, 2)}</span>
                                <span>{tip.slice(3)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

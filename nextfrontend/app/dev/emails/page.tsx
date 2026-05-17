'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trash2, Mail, ExternalLink, Clock, ChevronRight } from 'lucide-react';

interface DevEmail {
    id: number;
    timestamp: string;
    to: string;
    subject: string;
    html: string;
    links: string[];
}

export default function DevEmailsPage() {
    const [emails, setEmails]     = useState<DevEmail[]>([]);
    const [selected, setSelected] = useState<DevEmail | null>(null);
    const [loading, setLoading]   = useState(false);

    const fetchEmails = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/dev/emails');
            if (res.ok) setEmails(await res.json());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchEmails();
        const interval = setInterval(fetchEmails, 4000);
        return () => clearInterval(interval);
    }, [fetchEmails]);

    const clearAll = async () => {
        await fetch('/api/dev/emails', { method: 'DELETE' });
        setEmails([]);
        setSelected(null);
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const isActionLink = (url: string) =>
        url.includes('verify-email') || url.includes('reset-password');

    return (
        <div className="min-h-screen bg-gray-950 text-white flex flex-col">
            {/* Header */}
            <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between bg-gray-900">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                        <Mail className="w-4 h-4" />
                    </div>
                    <div>
                        <h1 className="font-bold text-white text-lg leading-none">Dev Email Inbox</h1>
                        <p className="text-xs text-gray-400 mt-0.5">Captures all emails sent by FarmRent in development</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
                        {emails.length} email{emails.length !== 1 ? 's' : ''}
                    </span>
                    <button
                        onClick={fetchEmails}
                        className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={clearAll}
                        className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
                        title="Clear all"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 65px)' }}>
                {/* Sidebar */}
                <div className="w-80 border-r border-gray-800 overflow-y-auto bg-gray-900 flex-shrink-0">
                    {emails.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8 text-center">
                            <Mail className="w-12 h-12 mb-3 opacity-30" />
                            <p className="text-sm font-medium">No emails yet</p>
                            <p className="text-xs mt-1">Register or use Forgot Password to trigger an email</p>
                        </div>
                    ) : (
                        emails.map(email => (
                            <button
                                key={email.id}
                                onClick={() => setSelected(email)}
                                className={`w-full text-left px-4 py-3.5 border-b border-gray-800 hover:bg-gray-800 transition-colors flex items-start gap-3 ${
                                    selected?.id === email.id ? 'bg-gray-800 border-l-2 border-l-green-500' : ''
                                }`}
                            >
                                <div className="w-8 h-8 rounded-full bg-green-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <Mail className="w-3.5 h-3.5 text-green-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-white truncate">{email.subject}</p>
                                    <p className="text-xs text-gray-400 truncate mt-0.5">{email.to}</p>
                                    <div className="flex items-center gap-1 mt-1">
                                        <Clock className="w-3 h-3 text-gray-600" />
                                        <span className="text-xs text-gray-600">{formatTime(email.timestamp)}</span>
                                    </div>
                                </div>
                                <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0 mt-2" />
                            </button>
                        ))
                    )}
                </div>

                {/* Main panel */}
                <div className="flex-1 overflow-y-auto bg-gray-950">
                    {selected ? (
                        <div className="p-6">
                            {/* Meta */}
                            <div className="mb-5">
                                <h2 className="text-xl font-bold text-white mb-3">{selected.subject}</h2>
                                <div className="bg-gray-900 rounded-xl p-4 space-y-2 text-sm">
                                    <div className="flex gap-2">
                                        <span className="text-gray-500 w-16 flex-shrink-0">To:</span>
                                        <span className="text-gray-200">{selected.to}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <span className="text-gray-500 w-16 flex-shrink-0">Sent:</span>
                                        <span className="text-gray-200">{new Date(selected.timestamp).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Action links */}
                            {selected.links.filter(isActionLink).length > 0 && (
                                <div className="mb-5 bg-green-950 border border-green-800 rounded-xl p-4">
                                    <p className="text-xs font-semibold text-green-400 mb-3 uppercase tracking-wide">
                                        Action Links — Click to proceed
                                    </p>
                                    <div className="space-y-2">
                                        {selected.links.filter(isActionLink).map((link, i) => (
                                            <a
                                                key={i}
                                                href={link}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
                                            >
                                                <ExternalLink className="w-4 h-4 flex-shrink-0" />
                                                {link.includes('verify-email') ? 'Verify Email Address' : 'Reset Password'}
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* HTML preview */}
                            <div className="rounded-xl overflow-hidden border border-gray-800">
                                <div className="bg-gray-900 px-4 py-2 text-xs text-gray-400 border-b border-gray-800">
                                    Email Preview
                                </div>
                                <div className="bg-white">
                                    <iframe
                                        srcDoc={selected.html}
                                        className="w-full"
                                        style={{ height: '500px', border: 'none' }}
                                        title="Email preview"
                                        sandbox="allow-same-origin"
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-600">
                            <Mail className="w-16 h-16 mb-4 opacity-20" />
                            <p className="text-sm">Select an email to preview it</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

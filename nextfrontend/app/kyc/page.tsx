'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    FileCheck, UploadCloud, ArrowLeft, ShieldCheck, AlertCircle, Clock, CheckCircle2, XCircle,
    FileText, Loader2, Info, Eye, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { kycApi } from '@/lib/api';

interface KycDocument {
    id: string;
    doc_type: string;
    status: 'pending' | 'approved' | 'rejected';
    rejection_reason?: string;
    file_url?: string;
    created_at: string;
}

const DOC_TYPES = [
    { id: 'aadhar',          label: 'Aadhaar Card',           icon: '🆔', desc: 'Government issued identity card' },
    { id: 'driving_license', label: 'Driving License',        icon: '🚗', desc: 'Valid commercial or non-commercial driving license' },
    { id: 'farm_proof',      label: 'Farm Property Proof',    icon: '🌾', desc: 'Pattadar passbook, land records, or 7/12 extract' },
    { id: 'gst',             label: 'GST Certificate',        icon: '📜', desc: 'Required for commercial machinery owners' },
];

const STATUS_BADGES: Record<string, { bg: string; icon: any; label: string }> = {
    unverified: { bg: 'bg-gray-100 border-gray-200 text-gray-700', icon: AlertCircle, label: 'Unverified' },
    pending:    { bg: 'bg-amber-50 border-amber-200 text-amber-800', icon: Clock,       label: 'Pending Verification' },
    verified:   { bg: 'bg-green-50 border-green-200 text-green-800', icon: CheckCircle2, label: 'Account Verified' },
    approved:   { bg: 'bg-green-50 border-green-200 text-green-800', icon: CheckCircle2, label: 'Approved' },
    rejected:   { bg: 'bg-red-50 border-red-200 text-red-800',     icon: XCircle,      label: 'Rejected' },
};

export default function KycPage() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();

    const [selectedDocType, setSelectedDocType] = useState<string>('aadhar');
    const [selectedFile, setSelectedFile]       = useState<File | null>(null);
    const [previewUrl, setPreviewUrl]           = useState<string | null>(null);
    const [uploading, setUploading]             = useState<boolean>(false);
    const [fetchingStatus, setFetchingStatus]   = useState<boolean>(true);
    const [documents, setDocuments]             = useState<KycDocument[]>([]);

    const fetchKycStatus = useCallback(async () => {
        try {
            setFetchingStatus(true);
            const res = await kycApi.getStatus();
            if (res && Array.isArray(res.documents)) {
                setDocuments(res.documents as KycDocument[]);
            }
        } catch (err: unknown) {
            console.error('Failed to fetch KYC status:', err);
        } finally {
            setFetchingStatus(false);
        }
    }, []);

    useEffect(() => {
        if (!authLoading && user) {
            fetchKycStatus();
        }
    }, [authLoading, user, fetchKycStatus]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Size check (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            toast.error('File size exceeds maximum limit of 5MB');
            return;
        }

        // Type check
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        if (!allowedTypes.includes(file.type)) {
            toast.error('Invalid file type. Please upload a JPG, PNG, WEBP, or PDF document');
            return;
        }

        setSelectedFile(file);
        if (file.type.startsWith('image/')) {
            setPreviewUrl(URL.createObjectURL(file));
        } else {
            setPreviewUrl(null);
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFile) {
            toast.error('Please select a document file to upload');
            return;
        }

        try {
            setUploading(true);
            const formData = new FormData();
            formData.append('document', selectedFile);
            formData.append('doc_type', selectedDocType);

            await kycApi.upload(formData);
            toast.success('Document uploaded successfully! Under admin review.');
            setSelectedFile(null);
            setPreviewUrl(null);
            fetchKycStatus();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to upload document');
        } finally {
            setUploading(false);
        }
    };

    // Calculate overall status based on documents
    const userKycStatus = (user as any)?.kyc_status ?? 'unverified';
    const overallBadge = STATUS_BADGES[userKycStatus] || STATUS_BADGES.unverified;
    const BadgeIcon = overallBadge.icon;

    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <Loader2 className="w-8 h-8 text-green-700 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-4xl mx-auto space-y-6">

                {/* ── Top Bar ── */}
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => router.back()}
                        className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-green-800 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Profile
                    </button>

                    <Link href="/dashboard" className="text-xs font-bold text-green-700 hover:underline">
                        Go to Dashboard →
                    </Link>
                </div>

                {/* ── Title Card ── */}
                <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-xl bg-green-100 text-green-700 flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black text-gray-900">KYC Verification</h1>
                            <p className="text-sm text-gray-500 mt-0.5">
                                Verify your identity to unlock priority bookings, instant machinery listings, and verified trust badges.
                            </p>
                        </div>
                    </div>

                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-bold shrink-0 ${overallBadge.bg}`}>
                        <BadgeIcon className="w-4 h-4" />
                        <span>{overallBadge.label}</span>
                    </div>
                </div>

                {/* ── Status Banner for Rejected / Pending ── */}
                {userKycStatus === 'rejected' && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
                        <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-red-900">KYC Verification Rejected</h4>
                            <p className="text-xs text-red-700 mt-1">
                                Your previous submission was rejected. Please review the reason below and upload a clear, valid document.
                            </p>
                        </div>
                    </div>
                )}

                {userKycStatus === 'pending' && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                        <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900">Verification in Progress</h4>
                            <p className="text-xs text-amber-700 mt-1">
                                Our admin team is reviewing your submitted documents. Verification usually completes within 24 hours.
                            </p>
                        </div>
                    </div>
                )}

                {/* ── Upload Form & List Grid ── */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">

                    {/* Upload Section (Left Column) */}
                    <div className="md:col-span-7 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
                        <div className="flex items-center justify-between border-b pb-4">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <UploadCloud className="w-5 h-5 text-green-700" />
                                Upload Identity Document
                            </h2>
                            <span className="text-xs text-gray-400">Max 5MB (JPG, PNG, PDF)</span>
                        </div>

                        <form onSubmit={handleUpload} className="space-y-4">

                            {/* Document Type Selector */}
                            <div>
                                <Label className="text-xs font-bold text-gray-700 mb-2 block">
                                    Select Document Type *
                                </Label>
                                <div className="grid grid-cols-2 gap-2.5">
                                    {DOC_TYPES.map(doc => (
                                        <button
                                            key={doc.id}
                                            type="button"
                                            onClick={() => setSelectedDocType(doc.id)}
                                            className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                                                selectedDocType === doc.id
                                                    ? 'border-green-600 bg-green-50/60 ring-2 ring-green-600/20'
                                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-lg">{doc.icon}</span>
                                                <span className="text-xs font-bold text-gray-800">{doc.label}</span>
                                            </div>
                                            <span className="text-[10px] text-gray-400 mt-1.5 line-clamp-1">{doc.desc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* File Upload Box */}
                            <div>
                                <Label className="text-xs font-bold text-gray-700 mb-2 block">
                                    Document File *
                                </Label>
                                <div className="border-2 border-dashed border-gray-200 hover:border-green-400 rounded-xl p-6 text-center transition-colors bg-gray-50/50 relative">
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp,application/pdf"
                                        onChange={handleFileChange}
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    />
                                    {selectedFile ? (
                                        <div className="space-y-2">
                                            {previewUrl ? (
                                                <div className="relative w-32 h-20 mx-auto rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                                                    {/* eslint-disable-next-next-img */}
                                                    <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <FileText className="w-10 h-10 text-green-700 mx-auto" />
                                            )}
                                            <p className="text-xs font-bold text-gray-800 truncate max-w-xs mx-auto">
                                                {selectedFile.name}
                                            </p>
                                            <p className="text-[10px] text-gray-400">
                                                {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB — Click to change
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            <UploadCloud className="w-8 h-8 text-gray-400 mx-auto" />
                                            <p className="text-xs font-bold text-gray-700">
                                                Click to upload or drag & drop file
                                            </p>
                                            <p className="text-[10px] text-gray-400">
                                                Supports JPG, PNG, WEBP, or PDF format
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <Button
                                type="submit"
                                disabled={uploading || !selectedFile}
                                className="w-full h-11 bg-green-700 hover:bg-green-800 font-bold rounded-xl text-sm"
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Uploading Document...
                                    </>
                                ) : (
                                    'Submit for Verification'
                                )}
                            </Button>
                        </form>
                    </div>

                    {/* Submitted Documents (Right Column) */}
                    <div className="md:col-span-5 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                        <div className="flex items-center justify-between border-b pb-4">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <FileCheck className="w-5 h-5 text-green-700" />
                                Submitted Documents
                            </h2>
                            <button
                                onClick={fetchKycStatus}
                                disabled={fetchingStatus}
                                className="text-gray-400 hover:text-green-700 transition-colors"
                                title="Refresh Status"
                            >
                                <RefreshCw className={`w-4 h-4 ${fetchingStatus ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        {fetchingStatus ? (
                            <div className="py-12 text-center text-gray-400">
                                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                                <span className="text-xs">Loading status...</span>
                            </div>
                        ) : documents.length === 0 ? (
                            <div className="py-10 text-center text-gray-400 space-y-2">
                                <FileText className="w-8 h-8 mx-auto text-gray-300" />
                                <p className="text-xs font-semibold">No documents uploaded yet</p>
                                <p className="text-[10px] text-gray-400">
                                    Upload an Aadhaar card or driving license to initiate verification.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {documents.map(doc => {
                                    const badge = STATUS_BADGES[doc.status] || STATUS_BADGES.pending;
                                    const BIcon = badge.icon;
                                    const docTypeMeta = DOC_TYPES.find(d => d.id === doc.doc_type);

                                    return (
                                        <div
                                            key={doc.id}
                                            className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 space-y-2 hover:border-gray-200 transition-all"
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-base">{docTypeMeta?.icon || '📄'}</span>
                                                    <span className="text-xs font-bold text-gray-800">
                                                        {docTypeMeta?.label || doc.doc_type}
                                                    </span>
                                                </div>
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg}`}>
                                                    <BIcon className="w-3 h-3" />
                                                    {badge.label}
                                                </span>
                                            </div>

                                            {doc.rejection_reason && (
                                                <p className="text-[11px] text-red-600 bg-red-50 p-2 rounded-lg border border-red-100">
                                                    <strong>Reason:</strong> {doc.rejection_reason}
                                                </p>
                                            )}

                                            <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1">
                                                <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                                                {doc.file_url && (
                                                    <a
                                                        href={doc.file_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-green-700 font-bold hover:underline"
                                                    >
                                                        <Eye className="w-3 h-3" /> View
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Guidelines Box */}
                        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3.5 text-xs text-blue-900 space-y-1.5 mt-4">
                            <div className="flex items-center gap-1.5 font-bold">
                                <Info className="w-4 h-4 text-blue-600" />
                                Guidelines for Quick Approval
                            </div>
                            <ul className="list-disc list-inside space-y-1 text-[11px] text-blue-800/80">
                                <li>Ensure the document image is clear and readable.</li>
                                <li>All 4 corners of the ID proof must be visible.</li>
                                <li>Name on document should match your registered profile.</li>
                            </ul>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}

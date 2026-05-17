'use client';

/**
 * ImageUploader — drag-and-drop / file picker with preview grid.
 * Uploads via POST /api/v1/upload/images (multipart/form-data).
 * Returns array of URLs to parent via onChange.
 */

import { useRef, useState } from 'react';
import { X, ImagePlus, Loader2 } from 'lucide-react';
import { getApiBaseUrl } from '@/lib/api';

interface Props {
    value: string[];                // current URLs
    onChange: (urls: string[]) => void;
    maxFiles?: number;
}

export default function ImageUploader({ value = [], onChange, maxFiles = 5 }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');

    const getToken = () => typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

    const uploadFiles = async (files: FileList | File[]) => {
        const arr = Array.from(files);
        if (value.length + arr.length > maxFiles) {
            setError(`Max ${maxFiles} images allowed`);
            return;
        }
        setError('');
        setUploading(true);
        try {
            const form = new FormData();
            arr.forEach(f => form.append('images', f));

            const base = getApiBaseUrl();
            const uploadPath = base ? `${base}/api/v1/upload/images` : '/api/v1/upload/images';
            const res = await fetch(uploadPath, {
                method: 'POST',
                headers: { Authorization: `Bearer ${getToken() ?? ''}` },
                body: form,
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message ?? `Upload failed (${res.status})`);
            }

            const data = await res.json();
            const urls: string[] = data?.data?.urls ?? data?.urls ?? [];
            onChange([...value, ...urls]);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        } finally { setUploading(false); }
    };

    const removeUrl = (idx: number) => {
        onChange(value.filter((_, i) => i !== idx));
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    };

    return (
        <div className="space-y-3">
            {/* Preview grid */}
            {value.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {value.map((url, i) => (
                        <div key={i} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-100 border">
                            <img src={url} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                            <button
                                type="button"
                                aria-label={`Remove image ${i + 1}`}
                                onClick={() => removeUrl(i)}
                                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Drop zone */}
            {value.length < maxFiles && (
                <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => inputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
                        ${dragOver ? 'border-green-600 bg-green-50' : 'border-gray-200 hover:border-green-400 hover:bg-gray-50'}`}
                >
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept="image/*"
                        aria-label="Choose images to upload"
                        className="hidden"
                        onChange={e => e.target.files && uploadFiles(e.target.files)}
                    />
                    <div className="flex flex-col items-center gap-2">
                        {uploading
                            ? <><Loader2 className="h-7 w-7 text-green-600 animate-spin" /><p className="text-sm text-green-700">Uploading…</p></>
                            : <><ImagePlus className="h-7 w-7 text-gray-400" />
                                <p className="text-sm text-gray-600">
                                    <span className="font-medium text-green-700">Click to upload</span> or drag & drop
                                </p>
                                <p className="text-xs text-gray-400">JPG, PNG, WEBP up to 5 MB · max {maxFiles} images</p>
                            </>
                        }
                    </div>
                </div>
            )}

            {error && <p className="text-xs text-red-500 flex items-center gap-1"><X className="h-3 w-3" />{error}</p>}
        </div>
    );
}

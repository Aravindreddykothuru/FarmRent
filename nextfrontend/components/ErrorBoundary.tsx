'use client';

import { Component, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
    section?: string;
}

interface State {
    hasError: boolean;
    errorMessage?: string;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        // HMR chunk errors (stale Turbopack module) — auto-reload to recover
        if (
            error.message.includes('module factory is not available') ||
            error.message.includes('ChunkLoadError') ||
            error.message.includes('Loading chunk') ||
            error.message.includes('instantiated because it was required')
        ) {
            if (typeof window !== 'undefined') window.location.reload();
            return { hasError: false };
        }
        return { hasError: true, errorMessage: error.message };
    }

    handleReset = () => {
        this.setState({ hasError: false, errorMessage: undefined });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            return (
                <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-2xl border border-red-100 text-center">
                    <AlertCircle className="h-10 w-10 text-red-400 mb-3" />
                    <h3 className="font-bold text-gray-800 mb-1">
                        {this.props.section ? `${this.props.section} failed to load` : 'Something went wrong'}
                    </h3>
                    <p className="text-sm text-gray-500 mb-4">
                        This section encountered an error. Please refresh or go home.
                    </p>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={this.handleReset}
                            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            <RefreshCw className="h-3.5 w-3.5" /> Retry
                        </button>
                        <Link href="/"
                            className="flex items-center gap-1.5 px-4 py-2 bg-green-700 rounded-xl text-sm font-semibold text-white hover:bg-green-800 transition-colors">
                            <Home className="h-3.5 w-3.5" /> Go Home
                        </Link>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;

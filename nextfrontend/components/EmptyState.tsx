'use client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
    action?: { label: string; href?: string; onClick?: () => void };
}

export default function EmptyState({ icon = '🔍', title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <div className="text-6xl mb-5">{icon}</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
            {description && <p className="text-gray-500 text-sm max-w-xs leading-relaxed mb-6">{description}</p>}
            {action && (
                action.href
                    ? <Link href={action.href}><Button className="bg-green-700 hover:bg-green-800">{action.label}</Button></Link>
                    : <Button className="bg-green-700 hover:bg-green-800" onClick={action.onClick}>{action.label}</Button>
            )}
        </div>
    );
}

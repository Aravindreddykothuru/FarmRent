'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/LanguageContext';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    // Intentionally minimal: avoid logging sensitive data in production.
    // In dev, Next will surface stack traces automatically.
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white border rounded-2xl shadow-sm p-6 text-center">
        <div className="text-xl font-bold text-gray-900">{t('common.error')}</div>
        <div className="text-sm text-gray-600 mt-2">
          {t('notFound.errorDesc')}
        </div>

        <div className="flex gap-2 justify-center mt-5">
          <Button onClick={reset} className="bg-green-700 hover:bg-green-800">
            {t('common.retry')}
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('notFound.refresh')}
          </Button>
        </div>
      </div>
    </div>
  );
}


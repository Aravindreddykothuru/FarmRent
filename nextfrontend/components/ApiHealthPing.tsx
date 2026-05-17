'use client';

import { useEffect } from 'react';

/**
 * Pings the backend health endpoint on startup so we fail fast
 * (and catch misconfigured ports/origin issues early).
 */
export default function ApiHealthPing() {
  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);

    fetch('/api/health', { signal: controller.signal })
      .then(() => {})
      .catch(() => {});

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, []);

  return null;
}


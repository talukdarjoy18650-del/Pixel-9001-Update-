'use client';

import { useEffect } from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-pwa-install';

export function PwaProvider() {
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {
        // Ignore registration errors in restricted preview contexts
      });
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-2.5 rounded-lg border-[3px] border-[var(--mc-outline)] bg-[var(--gold)] px-3.5 py-2.5 text-sm font-bold text-[#1f2a1a] shadow-[4px_4px_0_var(--mc-shadow)]"
    >
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>Offline Mode — Pixel art &amp; .schem tools continue working locally.</span>
    </div>
  );
}

'use client';

import { useState } from 'react';
import {
  Smartphone,
  Download,
  Check,
  Copy,
  X,
  MoreVertical,
  Share,
} from 'lucide-react';
import { usePWAInstall } from '@/hooks/use-pwa-install';
import { useToast } from '@/hooks/use-toast';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isAndroid, isIOS, isInIframe, install } =
    usePWAInstall();
  const { toast } = useToast();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState(false);

  // Suppress button when already launched from home screen / installed app
  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        toast({
          title: 'App Installed!',
          description: 'MC PixelArt has been added to your home screen.',
        });
      }
      return;
    }
    setShowGuide(true);
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast({
        title: 'App Link Copied',
        description: 'Open this link in Chrome on your Android phone to install.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Copy the URL from your browser address bar.',
      });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="mc-install-btn"
        title={isInstallable ? 'Install app on this device' : 'Install on Android or iPhone'}
        aria-label={isInstallable ? 'Install app' : 'Install on phone'}
      >
        {isInstallable ? (
          <Download className="h-[20px] w-[20px] shrink-0" style={{ color: 'var(--grass-dark)' }} />
        ) : (
          <Smartphone className="h-[20px] w-[20px] shrink-0" style={{ color: 'var(--grass-dark)' }} />
        )}
        <span className="whitespace-nowrap">
          {isInstallable ? 'Install App' : isIOS ? 'Install on iPhone' : 'Install App'}
        </span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="mc-card w-full max-w-[420px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mc-grass" aria-hidden="true" />
            <div className="p-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-[var(--mc-outline)] bg-[var(--grass)] text-white">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <h2
                      id="install-guide-title"
                      className="text-lg font-bold leading-tight text-[var(--mc-ink)]"
                    >
                      {isIOS ? 'Install on iPhone / iPad' : 'Install on Android Phone'}
                    </h2>
                    <p className="text-xs font-semibold text-[var(--mc-muted)]">
                      Runs offline &amp; full-screen like a native app
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="Close install instructions"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border-2 border-[var(--mc-outline)] bg-[var(--mc-field)] text-[var(--mc-ink)] hover:bg-[var(--mc-card)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {isIOS ? (
                <ol className="space-y-2.5 rounded-lg border-2 border-[var(--mc-outline)] bg-[var(--mc-field)] p-3.5 text-sm font-semibold text-[var(--mc-ink)]">
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--lapis)] text-xs font-bold text-white">
                      1
                    </span>
                    <span>
                      Open this page in <strong>Safari</strong> and tap the{' '}
                      <Share className="mx-0.5 inline h-4 w-4 align-text-bottom text-[var(--lapis)]" />{' '}
                      <strong>Share</strong> button.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--grass)] text-xs font-bold text-white">
                      2
                    </span>
                    <span>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--gold)] text-xs font-bold text-[#1f2a1a]">
                      3
                    </span>
                    <span>
                      Tap <strong>Add</strong> — launch anytime from your Home Screen!
                    </span>
                  </li>
                </ol>
              ) : (
                <div className="space-y-3">
                  {isInIframe && (
                    <div className="rounded-lg border-2 border-[var(--mc-outline)] bg-[color-mix(in_srgb,var(--gold)_24%,var(--mc-card))] p-3 text-xs font-bold leading-relaxed text-[var(--mc-ink)]">
                      You are viewing this inside an embedded preview. Copy the link below and open it directly in{' '}
                      <strong>Google Chrome</strong> on your Android phone to install.
                    </div>
                  )}

                  <ol className="space-y-2.5 rounded-lg border-2 border-[var(--mc-outline)] bg-[var(--mc-field)] p-3.5 text-sm font-semibold text-[var(--mc-ink)]">
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--grass)] text-xs font-bold text-white">
                        1
                      </span>
                      <span>
                        Open this app URL in <strong>Chrome</strong> (or Edge / Samsung Internet) on your Android phone.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--lapis)] text-xs font-bold text-white">
                        2
                      </span>
                      <span>
                        Tap the{' '}
                        <MoreVertical className="inline h-4 w-4 align-text-bottom text-[var(--lapis)]" />{' '}
                        <strong>Menu</strong> icon in the top-right corner.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[var(--diamond)] text-xs font-bold text-[#1f2a1a]">
                        3
                      </span>
                      <span>
                        Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>) and confirm{' '}
                        <strong>Install</strong>.
                      </span>
                    </li>
                  </ol>

                  {!isAndroid && (
                    <p className="text-xs font-semibold text-[var(--mc-muted)]">
                      Tip: Copy the link below and send it to your Android phone to install immediately.
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="mc-btn-download primary flex-1"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 shrink-0" />
                      <span>Link Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 shrink-0" />
                      <span>Copy App Link</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  className="mc-btn-download secondary"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

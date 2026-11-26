import React, { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'full' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 active:scale-[0.98] transition-all whitespace-nowrap shrink-0 ${
          variant === 'full' ? 'w-full px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs min-h-[40px]'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 ${
            variant === 'full' ? 'w-full px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs min-h-[40px]'
          }`}
        >
          <Share className="w-4 h-4 shrink-0" />
          Install on iPhone
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-hidden"
            onTouchMove={(e) => e.stopPropagation()}
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Add MoneyLedger to iPhone
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close guide"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
                <li>1. Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.</li>
                <li>2. Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>3. Tap <strong>Add</strong> for instant offline access and alerts.</li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

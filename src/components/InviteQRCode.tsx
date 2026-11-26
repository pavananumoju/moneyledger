import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { buildInviteUrl } from '../utils/inviteQr';

interface InviteQRCodeProps {
  inviteCode: string;
  householdName: string;
  compact?: boolean;
}

export const InviteQRCode: React.FC<InviteQRCodeProps> = ({
  inviteCode,
  householdName,
  compact = false,
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const inviteUrl = buildInviteUrl(inviteCode);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(inviteUrl, {
      width: 440,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) {
          setQrDataUrl(url);
          setError(null);
        }
      })
      .catch(() => {
        if (active) {
          setError('Unable to generate QR code.');
        }
      });

    return () => {
      active = false;
    };
  }, [inviteUrl]);

  const handleSaveQrImage = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `moneyledger-invite-${inviteCode.toLowerCase()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col items-center text-center gap-3">
      {/* Always render QR on a crisp white quiet-zone so any camera can scan it reliably */}
      <div
        className={`rounded-2xl bg-white p-3 border border-slate-200 shadow-sm inline-flex items-center justify-center ${
          compact ? 'w-40 h-40' : 'w-48 h-48'
        }`}
      >
        {error ? (
          <p className="text-xs text-rose-600 px-2">{error}</p>
        ) : qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`QR code to join ${householdName} (${inviteCode})`}
            className="w-full h-full object-contain rounded-lg select-none"
          />
        ) : (
          <div className="w-full h-full rounded-lg bg-slate-100 animate-pulse" />
        )}
      </div>

      <div className="space-y-1 max-w-xs">
        <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
          Scan with MoneyLedger or your phone camera
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Code <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{inviteCode}</span> works manually too
        </p>
      </div>

      {!compact && qrDataUrl && (
        <button
          type="button"
          onClick={handleSaveQrImage}
          className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          Save QR Image
        </button>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, ImageUp, RefreshCw, X } from 'lucide-react';
import { extractInviteCodeFromScan } from '../utils/inviteQr';
import { triggerHaptic } from '../utils/finance';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanCode: (code: string) => void;
}

export const QRScannerModal: React.FC<QRScannerModalProps> = ({
  isOpen,
  onClose,
  onScanCode,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const scannedRef = useRef(false);

  const [cameraState, setCameraState] = useState<'starting' | 'active' | 'unavailable'>('starting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleDecodedPayload = useCallback(
    (rawValue: string) => {
      if (scannedRef.current) return false;
      const code = extractInviteCodeFromScan(rawValue);
      if (!code) {
        setErrorMsg('That QR code is not a valid MoneyLedger partner invite.');
        return false;
      }
      scannedRef.current = true;
      triggerHaptic(15);
      stopCamera();
      onScanCode(code);
      onClose();
      return true;
    },
    [onClose, onScanCode, stopCamera]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    scannedRef.current = false;
    setErrorMsg(null);
    setCameraState('starting');

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setCameraState('unavailable');
      setErrorMsg('Live camera is unavailable here. Upload a QR screenshot instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      video.srcObject = stream;
      await video.play();
      setCameraState('active');

      let lastCheck = 0;
      const scanFrame = (ts: number) => {
        if (scannedRef.current) return;
        const vid = videoRef.current;
        const canvas = canvasRef.current;

        if (vid && canvas && vid.readyState >= vid.HAVE_ENOUGH_DATA && ts - lastCheck >= 110) {
          lastCheck = ts;
          const w = vid.videoWidth;
          const h = vid.videoHeight;
          if (w > 0 && h > 0) {
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(vid, 0, 0, w, h);
              const imgData = ctx.getImageData(0, 0, w, h);
              const result = jsQR(imgData.data, w, h, {
                inversionAttempts: 'attemptBoth',
              });
              if (result?.data) {
                const accepted = handleDecodedPayload(result.data);
                if (accepted) return;
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanFrame);
      };

      rafRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setCameraState('unavailable');
      setErrorMsg(
        'Camera access was blocked or no camera was found. Allow camera access or upload a QR image below.'
      );
    }
  }, [handleDecodedPayload, stopCamera]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [isOpen, startCamera, stopCamera]);

  const handlePickQrImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const maxDim = 1200;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          setErrorMsg('Unable to read image.');
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const result = jsQR(imgData.data, w, h, {
          inversionAttempts: 'attemptBoth',
        });
        if (result?.data) {
          handleDecodedPayload(result.data);
        } else {
          setErrorMsg('No QR code detected in that image. Try cropping closer to the QR square.');
        }
      };
      img.onerror = () => setErrorMsg('Could not open the selected image file.');
      if (typeof reader.result === 'string') {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 overflow-hidden"
      onTouchMove={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Camera className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              Scan Partner QR Code
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Point your camera at your partner&apos;s MoneyLedger QR code to connect instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Close QR scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative aspect-square w-full max-w-[290px] mx-auto rounded-2xl overflow-hidden bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover ${
              cameraState === 'active' ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {cameraState === 'active' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-48 h-48 relative">
                <span className="absolute top-0 left-0 w-7 h-7 border-t-[3px] border-l-[3px] border-teal-400 rounded-tl-xl" />
                <span className="absolute top-0 right-0 w-7 h-7 border-t-[3px] border-r-[3px] border-teal-400 rounded-tr-xl" />
                <span className="absolute bottom-0 left-0 w-7 h-7 border-b-[3px] border-l-[3px] border-teal-400 rounded-bl-xl" />
                <span className="absolute bottom-0 right-0 w-7 h-7 border-b-[3px] border-r-[3px] border-teal-400 rounded-br-xl" />
              </div>
            </div>
          )}

          {cameraState === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300 px-4 text-center">
              <Camera className="w-7 h-7 text-teal-400 animate-pulse" />
              <p className="text-xs font-medium">Starting camera...</p>
            </div>
          )}

          {cameraState === 'unavailable' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-300 px-5 text-center">
              <Camera className="w-7 h-7 text-slate-400" />
              <p className="text-xs text-slate-300 leading-relaxed">
                Camera preview unavailable
              </p>
              <button
                type="button"
                onClick={() => void startCamera()}
                className="min-h-[36px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Camera
              </button>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
            {errorMsg}
          </div>
        )}

        <div className="pt-1 flex flex-col gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handlePickQrImage}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[44px] px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors inline-flex items-center justify-center gap-2"
          >
            <ImageUp className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            Upload QR Image / Screenshot
          </button>
        </div>
      </div>
    </div>
  );
};

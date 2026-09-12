'use client';

/**
 * Live photo capture for a checkpoint submission.
 *
 * Two paths, deliberately:
 *  1. `<input type="file" capture="environment">` — opens the native camera on
 *     iOS and Android. This is the primary path because it works on mobile
 *     Safari, where getUserMedia inside a non-HTTPS or embedded context is
 *     unreliable, and it gives the player their familiar camera UI.
 *  2. A file picker fallback for desktop, used by the laptop demo.
 *
 * Images are downscaled before upload: a modern phone photo is 3-8 MB, which is
 * slow to upload on venue wifi and pointless for landmark matching. 1280px on
 * the long edge is plenty for Gemini to identify a building and a hand gesture.
 */

import { useCallback, useRef, useState } from 'react';

const MAX_EDGE_PX = 1280;
const JPEG_QUALITY = 0.82;

export interface PhotoCaptureProps {
  onCapture: (dataUrl: string) => void;
  disabled?: boolean;
}

/** Downscale and re-encode, so we upload ~200KB instead of ~6MB. */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

export default function PhotoCapture({ onCapture, disabled }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const dataUrl = await downscale(file);
        setPreview(dataUrl);
        onCapture(dataUrl);
      } catch {
        setError('Could not read that image. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [onCapture],
  );

  const retake = useCallback(() => {
    setPreview(null);
    setError(null);
    // Clearing the value matters: selecting the SAME file twice fires no
    // change event otherwise, so a retake of an identical shot would hang.
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  }, []);

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {preview ? (
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Your submission"
            style={{ width: '100%', borderRadius: 12, display: 'block', border: '1px solid var(--line)' }}
          />
          <button className="btn" onClick={retake} disabled={disabled} style={{ marginTop: 10, width: '100%' }}>
            Retake photo
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ width: '100%' }}
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Processing…' : '📷 Take photo'}
        </button>
      )}

      {error && <p style={{ color: 'var(--bad)', fontSize: 14, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}

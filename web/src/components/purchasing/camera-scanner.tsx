"use client";

import { useEffect, useRef } from "react";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39"];

/** The browser's built-in barcode detector (Chrome on Android); needs HTTPS for the camera. */
export function cameraScanSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!window.BarcodeDetector &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

/** Live back-camera preview that reports each barcode once (repeats within 2 s are ignored). */
export function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const last = { code: "", at: 0 };

    (async () => {
      const Detector = window.BarcodeDetector;
      if (!Detector) return;
      const detector = new Detector({ formats: FORMATS });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (stopped || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      const tick = async () => {
        if (stopped || !video.current) return;
        try {
          const [found] = await detector.detect(video.current);
          const now = Date.now();
          if (found && (found.rawValue !== last.code || now - last.at > 2000)) {
            last.code = found.rawValue;
            last.at = now;
            navigator.vibrate?.(60);
            onCodeRef.current(found.rawValue);
          }
        } catch {
          // A frame that cannot be read: try the next one.
        }
        timer = window.setTimeout(tick, 250);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl bg-black">
      <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
      <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
    </div>
  );
}

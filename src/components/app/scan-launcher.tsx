"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DetectResult = { rawValue?: string };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<DetectResult[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export function ScanLauncher() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const stopScanner = () => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => stopScanner, []);

  const startScanner = async () => {
    try {
      if (!window.BarcodeDetector) {
        setError("Live scanning is not available in this browser. Use manual barcode entry below.");
        return;
      }

      const detector = new window.BarcodeDetector({
        formats: ["qr_code", "code_128", "code_39"],
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      streamRef.current = stream;

      if (!videoRef.current) {
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      setError(null);

      const scanFrame = async () => {
        if (!videoRef.current) {
          return;
        }

        try {
          const results = await detector.detect(videoRef.current);

          if (results[0]?.rawValue) {
            stopScanner();
            window.location.assign(`/scan/${encodeURIComponent(results[0].rawValue)}`);
            return;
          }
        } catch {
          setError("Camera started, but no readable barcode was detected yet.");
        }

        frameRef.current = window.requestAnimationFrame(scanFrame);
      };

      frameRef.current = window.requestAnimationFrame(scanFrame);
    } catch {
      setError("Camera access failed. Use manual barcode entry instead.");
      stopScanner();
    }
  };

  return (
    <div className="space-y-5">
      <form action="/scan/lookup" className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <Input
          data-testid="barcode-manual-input"
          defaultValue="CM-A101-001"
          name="barcode"
          placeholder="Enter cage barcode"
        />
        <Button type="submit" variant="default">
          Open cage
        </Button>
        <Button onClick={scanning ? stopScanner : startScanner} type="button" variant="subtle">
          {scanning ? "Stop camera" : "Start camera scan"}
        </Button>
      </form>
      <div className="overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--surface-2)]">
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
      </div>
      {error ? <p className="text-sm text-amber-800">{error}</p> : null}
      <p className="text-sm leading-7 text-[var(--muted)]">
        Live scan uses the browser camera when available. Manual barcode lookup always works.
      </p>
    </div>
  );
}

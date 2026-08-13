"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Keyboard, QrCode, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DetectResult = { rawValue?: string };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<DetectResult[]>;
};
type QuickCage = {
  barcode: string;
  label: string;
  occupantCount: number;
  status: string;
  strainSummary: string;
  warningCount: number;
};

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export function ScanLauncher({ quickCages = [] }: { quickCages?: QuickCage[] }) {
  const router = useRouter();
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
            router.push(`/scan/${encodeURIComponent(results[0].rawValue)}`);
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

  const openManualBarcode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const barcode = String(new FormData(event.currentTarget).get("barcode") ?? "").trim();

    if (!barcode) {
      setError("Enter a cage barcode to continue.");
      return;
    }

    setError(null);
    router.push(`/scan/${encodeURIComponent(barcode)}`);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <div className="rounded-[1.35rem] border border-[var(--line)] bg-white/55 p-4">
          <div className="mb-4 flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Keyboard className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Manual lookup</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.03em]">Open cage</h2>
            </div>
          </div>
          <form action="/scan/lookup" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={openManualBarcode}>
            <Input
              data-testid="barcode-manual-input"
              name="barcode"
              placeholder="Enter cage barcode"
              required
            />
            <Button type="submit" variant="default">
              Open cage
            </Button>
          </form>
          {error ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p> : null}
        </div>

        <div className="rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Round shortcuts</p>
              <h3 className="mt-1 font-display text-xl font-semibold tracking-[-0.03em]">Attention cages</h3>
            </div>
            <Badge variant="info">{quickCages.length}</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {quickCages.length ? (
              quickCages.map((cage) => (
                <Link
                  className="group rounded-2xl border border-[var(--line)] bg-white/65 p-3 transition hover:border-[var(--line-strong)] hover:bg-white"
                  href={`/scan/${encodeURIComponent(cage.barcode)}`}
                  key={cage.barcode}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{cage.label}</p>
                      <p className="mt-1 truncate font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]">{cage.barcode}</p>
                    </div>
                    <Badge variant={cage.warningCount ? "warning" : "success"}>{cage.warningCount ? `${cage.warningCount} warning` : cage.status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--muted)]">
                    {cage.occupantCount} occupants · {cage.strainSummary}
                  </p>
                </Link>
              ))
            ) : (
              <Link className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent)]" href="/cages/intake?mode=new">
                No cages yet · Create first cage
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface-2)] p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--hero)] text-[var(--hero-ink)]">
              <Camera className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--muted)]">Camera scan</p>
              <h2 className="font-display text-xl font-semibold tracking-[-0.03em]">{scanning ? "Scanning" : "Ready"}</h2>
            </div>
          </div>
          <Button onClick={scanning ? stopScanner : startScanner} type="button" variant="subtle">
            {scanning ? "Stop camera" : "Start camera scan"}
          </Button>
        </div>

        <div className="relative min-h-[24rem] overflow-hidden rounded-[28px] border border-[var(--line)] bg-[var(--surface-2)]">
          <video
            ref={videoRef}
            className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", scanning ? "opacity-100" : "opacity-0")}
            muted
            playsInline
          />
          {!scanning ? (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              <div className="max-w-md">
                <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-[var(--line)] bg-white/70 text-[var(--accent)]">
                  <QrCode className="h-8 w-8" />
                </span>
                <h3 className="mt-5 font-display text-2xl font-semibold tracking-[-0.04em]">Camera preview</h3>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Scan", "Camera"],
            ["Open", "Cage record"],
            ["Add note", "Health and moves"],
          ].map(([title, copy]) => (
            <div className="rounded-2xl border border-[var(--line)] bg-white/60 p-3" key={title}>
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" />
              <p className="mt-3 font-medium">{title}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

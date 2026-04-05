import QRCode from "qrcode";

import { Surface } from "@/components/app/surface";

export async function CageQrCard({ barcode }: { barcode: string }) {
  const image = await QRCode.toDataURL(barcode, {
    width: 180,
    margin: 1,
    color: {
      dark: "#10233F",
      light: "#FFFFFF",
    },
  });

  return (
    <Surface className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Cage card QR</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-0.04em]">Barcode-ready lookup</h2>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`QR code for ${barcode}`} className="rounded-2xl border border-[var(--line)] bg-white p-3" src={image} />
      <p className="font-mono text-sm text-[var(--muted)]">{barcode}</p>
    </Surface>
  );
}

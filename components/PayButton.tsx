"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  quoteId: string;
  sig: string;
  buyerId: string;
  clientId: string | null;
  onPaid: (result: { status: string; note?: string }) => void;
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(clientId: string): Promise<void> {
  if ((window as any).paypal?.Buttons) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
      s.onload = () => resolve();
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error("PayPal SDK failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

/**
 * Pays a signed quote. The browser sends only the quote ID and signature; the
 * server creates the PayPal order from the stored quote. Uses PayPal's JS SDK
 * buttons, with a redirect to PayPal's approval page as the fallback.
 */
export default function PayButton({ quoteId, sig, buyerId, clientId, onPaid }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let buttons: any;
    loadSdk(clientId)
      .then(() => {
        if (cancelled || !box.current) return;
        const paypal = (window as any).paypal;
        buttons = paypal.Buttons({
          style: { layout: "horizontal", height: 40, tagline: false },
          createOrder: async () => {
            setError("");
            const res = await api<{ paypalOrderId: string }>("/api/checkout", { body: { quoteId, sig, buyerId } });
            return res.paypalOrderId;
          },
          onApprove: async (data: { orderID: string }) => {
            const res = await api<{ status: string; note?: string }>("/api/capture", {
              body: { paypalOrderId: data.orderID, buyerId },
            });
            onPaid(res);
          },
          onError: (err: unknown) => setError(err instanceof Error ? err.message : "PayPal could not complete the payment"),
        });
        if (buttons.isEligible()) {
          box.current.innerHTML = "";
          buttons.render(box.current);
          setSdkReady(true);
        }
      })
      .catch(() => setSdkReady(false));
    return () => {
      cancelled = true;
      try {
        buttons?.close();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, quoteId, sig, buyerId]);

  async function redirectFlow() {
    setBusy(true);
    setError("");
    try {
      const res = await api<{ approveUrl?: string }>("/api/checkout", { body: { quoteId, sig, buyerId } });
      if (!res.approveUrl) throw new Error("PayPal did not return an approval link");
      window.location.href = res.approveUrl;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div ref={box} className={sdkReady ? "" : "hidden"} />
      {!sdkReady && (
        <button className="btn btn-primary w-full" onClick={redirectFlow} disabled={busy}>
          {busy ? "Opening PayPal..." : "Pay with PayPal"}
        </button>
      )}
      {error && <p className="text-xs font-medium text-bad">{error}</p>}
    </div>
  );
}

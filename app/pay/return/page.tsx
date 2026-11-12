"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmt } from "@/lib/client";

interface Result {
  status: string;
  amount: number;
  paypalOrderId: string;
  apiVerified: boolean;
  webhookVerified: boolean;
  note?: string;
}

// PayPal sends the buyer back here after approval (?token=<PayPal order ID>).
export default function PayReturn() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("No PayPal order reference in the link.");
      return;
    }
    let tries = 0;
    let stop = false;
    async function run() {
      try {
        // No buyer ID is sent: an agent's human may approve on a different device.
        const res = await api<Result>("/api/capture", { body: { paypalOrderId: token } });
        if (stop) return;
        setResult(res);
        // If webhook verification is required, poll briefly until it lands.
        if (res.status === "captured" && tries < 10) {
          tries += 1;
          setTimeout(run, 2500);
        }
      } catch (err) {
        if (!stop) setError((err as Error).message);
      }
    }
    run();
    return () => {
      stop = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="card p-8 text-center">
        {!result && !error && <p className="text-muted">Confirming your payment with PayPal...</p>}
        {error && (
          <>
            <span className="badge badge-bad">Not confirmed</span>
            <p className="mt-4 text-sm text-bad">{error}</p>
          </>
        )}
        {result && (
          <>
            <span className={`badge ${result.status === "paid" ? "badge-ok" : "badge-warn"}`}>
              {result.status === "paid" ? "Paid and verified" : `Status: ${result.status}`}
            </span>
            <div className="mt-4 text-3xl font-bold">{fmt(result.amount)}</div>
            <p className="mono mt-1 text-xs text-muted">PayPal order {result.paypalOrderId}</p>
            <ul className="mx-auto mt-5 max-w-xs space-y-1 text-left text-sm">
              <li>{result.apiVerified ? "✓" : "…"} Order re-fetched from PayPal and matched to the signed quote</li>
              <li>{result.webhookVerified ? "✓" : "…"} Signature-verified PayPal webhook received</li>
            </ul>
            {result.note && <p className="mt-4 text-xs text-muted">{result.note}</p>}
          </>
        )}
        <div className="mt-6">
          <Link href="/shop" className="btn">Back to the storefront</Link>
        </div>
      </div>
    </div>
  );
}

import { handleWebhook } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// PayPal webhook endpoint. Register this URL in the PayPal developer dashboard
// and put the resulting webhook ID in PAYPAL_WEBHOOK_ID.
export async function POST(req: Request) {
  const raw = await req.text();
  const outcome = await handleWebhook(raw, {
    transmissionId: req.headers.get("paypal-transmission-id"),
    transmissionTime: req.headers.get("paypal-transmission-time"),
    transmissionSig: req.headers.get("paypal-transmission-sig"),
    certUrl: req.headers.get("paypal-cert-url"),
    authAlgo: req.headers.get("paypal-auth-algo"),
  });
  return Response.json({ ok: outcome.accepted, message: outcome.message }, { status: outcome.status });
}

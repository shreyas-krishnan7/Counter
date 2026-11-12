import { refundOrder } from "@/lib/checkout";
import { adminDenied, body, cleanId, errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Seller kill switch: refund a captured payment through PayPal Payments v2.
export async function POST(req: Request) {
  const denied = adminDenied(req);
  if (denied) return denied;
  try {
    const { orderId } = await body<{ orderId?: string }>(req);
    const order = await refundOrder(cleanId(orderId), "seller");
    return json({ ok: true, order });
  } catch (err) {
    return errorResponse(err);
  }
}

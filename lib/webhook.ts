import { db, logEvent, save, uid } from "./store";
import * as paypal from "./paypal";
import { captureAndReconcile, findOrder, onVerifiedCapture } from "./checkout";

export interface WebhookOutcome {
  accepted: boolean;
  status: number;
  message: string;
}

/**
 * The real webhook path. Fails closed: an event that PayPal does not vouch
 * for changes nothing, including when verification is not configured.
 */
export async function handleWebhook(
  rawBody: string,
  headers: paypal.WebhookHeaders,
  meta: { runId?: string } = {}
): Promise<WebhookOutcome> {
  let event: { id?: string; event_type?: string; resource?: Record<string, unknown> } = {};
  try {
    event = JSON.parse(rawBody);
  } catch {
    logEvent({
      shields: "on", channel: "webhook", actor: "unknown sender", type: "webhook.rejected", verdict: "block",
      reason: "Body is not valid JSON", runId: meta.runId,
    });
    return { accepted: false, status: 400, message: "Invalid body" };
  }

  if (!paypal.webhookConfigured()) {
    logEvent({
      shields: "on", channel: "webhook", actor: "unknown sender", type: "webhook.rejected", verdict: "block",
      reason: "Cannot verify: PAYPAL_WEBHOOK_ID is not configured, so the event is ignored",
      detail: String(event.event_type || ""), runId: meta.runId,
    });
    return { accepted: false, status: 503, message: "Webhook verification is not configured" };
  }

  let verified = false;
  try {
    verified = await paypal.verifyWebhookSignature(rawBody, headers);
  } catch {
    verified = false;
  }
  db().webhooks.push({
    id: event.id || uid("wh"),
    eventType: String(event.event_type || "unknown"),
    verified,
    ts: Date.now(),
    resourceId: String((event.resource as { id?: string } | undefined)?.id || ""),
  });
  if (db().webhooks.length > 500) db().webhooks.splice(0, db().webhooks.length - 500);
  save();

  if (!verified) {
    logEvent({
      shields: "on", channel: "webhook", actor: "unknown sender", type: "webhook.rejected", verdict: "block",
      reason: "PayPal signature verification failed: forged or tampered webhook",
      detail: String(event.event_type || ""), runId: meta.runId,
    });
    return { accepted: false, status: 401, message: "Signature verification failed" };
  }

  const resource = (event.resource || {}) as {
    id?: string;
    custom_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
  };
  logEvent({
    shields: "on", channel: "webhook", actor: "PayPal", type: "webhook.verified", verdict: "allow",
    reason: "Signature verified with PayPal", detail: `${event.event_type} ${resource.id || ""}`,
  });

  try {
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      await onVerifiedCapture(resource.supplementary_data?.related_ids?.order_id, resource.custom_id);
    } else if (event.event_type === "CHECKOUT.ORDER.APPROVED" && resource.id) {
      const order = findOrder(resource.id);
      if (order && order.status === "created") await captureAndReconcile(order.paypalOrderId);
    } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") {
      const order = db().orders.find(
        (o) => o.paypalOrderId === resource.supplementary_data?.related_ids?.order_id
      );
      if (order && order.status !== "mismatch_refunded") {
        order.status = "refunded";
        order.updatedAt = Date.now();
        save();
      }
    }
  } catch (err) {
    logEvent({
      shields: "on", channel: "webhook", actor: "PayPal", type: "webhook.processing_error", verdict: "info",
      reason: (err as Error).message,
    });
  }
  return { accepted: true, status: 200, message: "ok" };
}

/**
 * UNGUARDED baseline for the Red Team "shields off" run only. It trusts the
 * body without asking PayPal, which is exactly the mistake Counter prevents.
 * It can only touch NaiveOrder records, never real orders.
 */
export function naiveWebhook(rawBody: string, runId?: string): WebhookOutcome {
  try {
    const event = JSON.parse(rawBody) as { event_type?: string; resource?: { custom_id?: string } };
    const target = db().naiveOrders.find((o) => o.id === event.resource?.custom_id);
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED" && target) {
      target.paid = true;
      save();
      logEvent({
        shields: "off", channel: "webhook", actor: "unknown sender", type: "webhook.trusted_unsigned", verdict: "breach",
        reason: "Unsigned webhook was trusted: order marked paid with no money received",
        detail: target.id, runId,
      });
      return { accepted: true, status: 200, message: "ok" };
    }
  } catch {
    /* ignore */
  }
  return { accepted: false, status: 400, message: "ignored" };
}

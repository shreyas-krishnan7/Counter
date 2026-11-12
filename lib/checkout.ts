import crypto from "node:crypto";
import { db, getBuyer, getProduct, logEvent, save, uid } from "./store";
import { verifyQuote } from "./engine";
import { fmt, fromValue, toValue } from "./money";
import * as paypal from "./paypal";
import type { Order } from "./types";

// Checkout and "payment truth".
//
// An order is created only from a signed quote, and the amount sent to PayPal
// is read from the stored quote, never from the request.
// An order becomes PAID only when (a) a fresh fetch of the PayPal order
// matches the quote and (b) a signature-verified PayPal webhook has arrived.
// If no webhook ID is configured (local development without a public URL),
// (a) alone is accepted and the order is labelled as API-confirmed only.

export class CheckoutError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function findOrder(idOrPaypalId: string): Order | undefined {
  return db().orders.find((o) => o.id === idOrPaypalId || o.paypalOrderId === idOrPaypalId);
}

export async function createOrderFromQuote(args: {
  quoteId: string;
  sig: string;
  buyerId: string;
  origin: string;
  channel: "chat" | "mcp" | "redteam";
  runId?: string;
}): Promise<Order> {
  const check = verifyQuote(args.quoteId, args.sig, args.buyerId);
  if (!check.ok) {
    logEvent({
      shields: "on", channel: "checkout", actor: args.buyerId, type: "checkout.rejected", verdict: "block",
      reason: check.reason, detail: `Quote ${args.quoteId}`, runId: args.runId,
    });
    throw new CheckoutError(check.reason, 403);
  }
  const quote = check.quote;
  const existing = db().orders.find((o) => o.quoteId === quote.id);
  if (existing) return existing;

  const product = getProduct(quote.productId);
  const ppOrder = await paypal.createOrder({
    quoteId: quote.id,
    description: `${quote.qty} x ${product?.name ?? quote.productId}`,
    amountValue: toValue(quote.total),
    requestId: crypto.createHash("sha256").update(quote.sig).digest("hex").slice(0, 36),
    returnUrl: `${args.origin}/pay/return`,
    cancelUrl: `${args.origin}/shop?cancelled=${encodeURIComponent(quote.id)}`,
  });
  const links: { rel: string; href: string }[] = ppOrder.links || [];
  const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  const order: Order = {
    id: uid("ord"),
    quoteId: quote.id,
    buyerId: quote.buyerId,
    paypalOrderId: ppOrder.id,
    approveUrl: approve?.href,
    amount: quote.total,
    status: "created",
    apiVerified: false,
    webhookVerified: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  db().orders.push(order);
  quote.status = "ordered";
  save();
  logEvent({
    shields: "on", channel: "checkout", actor: args.buyerId, type: "paypal.order_created", verdict: "allow",
    reason: "PayPal order created from signed quote",
    detail: `${ppOrder.id} for ${fmt(quote.total)} (quote ${quote.id})`, runId: args.runId,
  });
  return order;
}

function finalize(order: Order): void {
  const needsWebhook = paypal.webhookConfigured();
  if (order.status === "paid" || order.status === "refunded" || order.status === "mismatch_refunded") return;
  if (!order.apiVerified) return;
  if (needsWebhook && !order.webhookVerified) {
    order.note = "Captured and matched by API. Waiting for the signed PayPal webhook.";
    return;
  }
  order.status = "paid";
  order.note = needsWebhook
    ? "Verified by signed PayPal webhook and API re-fetch."
    : "API-confirmed only: PAYPAL_WEBHOOK_ID is not configured.";
  const quote = db().quotes.find((q) => q.id === order.quoteId);
  if (quote) {
    quote.status = "paid";
    const product = getProduct(quote.productId);
    if (product) product.stock = Math.max(0, product.stock - quote.qty);
  }
  const buyer = getBuyer(order.buyerId);
  buyer.paidOrders += 1;
  if (order.payerId && !buyer.payerIds.includes(order.payerId)) buyer.payerIds.push(order.payerId);
  logEvent({
    shields: "on", channel: "checkout", actor: order.buyerId, type: "order.paid", verdict: "allow",
    reason: order.note, detail: `${order.paypalOrderId} ${fmt(order.amount)} payer ${order.payerId ?? "unknown"}`,
  });
}

/** Re-fetches the order from PayPal and compares it with the signed quote. */
export async function reconcile(order: Order): Promise<Order> {
  const quote = db().quotes.find((q) => q.id === order.quoteId);
  const pp = await paypal.getOrder(order.paypalOrderId);
  const unit = pp.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  order.updatedAt = Date.now();
  if (pp.payer?.payer_id) order.payerId = pp.payer.payer_id;
  if (!capture) {
    save();
    return order;
  }
  order.captureId = capture.id;
  if (capture.status === "REFUNDED" || capture.status === "PARTIALLY_REFUNDED") {
    order.status = "refunded";
    save();
    return order;
  }
  const amountOk = quote && fromValue(capture.amount?.value) === quote.total && capture.amount?.currency_code === "USD";
  const idOk = quote && (unit.custom_id === quote.id || capture.custom_id === quote.id);
  if (!amountOk || !idOk) {
    logEvent({
      shields: "on", channel: "checkout", actor: order.buyerId, type: "order.mismatch", verdict: "block",
      reason: "Captured payment does not match the signed quote. Refunding.",
      detail: `${order.paypalOrderId}: captured ${capture.amount?.value} ${capture.amount?.currency_code}, expected ${quote ? toValue(quote.total) : "?"}`,
    });
    try {
      await paypal.refundCapture(capture.id, "Payment did not match the quote and was refunded automatically.");
      order.status = "mismatch_refunded";
    } catch (err) {
      order.note = `Mismatch detected but refund failed: ${(err as Error).message}`;
    }
    save();
    return order;
  }
  if (capture.status !== "COMPLETED") {
    order.status = "captured";
    order.note = `Capture is ${capture.status}; not treating as paid.`;
    save();
    return order;
  }
  if (order.status === "created") order.status = "captured";
  order.apiVerified = true;
  finalize(order);
  save();
  return order;
}

export async function captureAndReconcile(paypalOrderId: string, buyerId?: string): Promise<Order> {
  const order = findOrder(paypalOrderId);
  if (!order) throw new CheckoutError("Unknown order", 404);
  if (buyerId && order.buyerId !== buyerId) throw new CheckoutError("Order belongs to a different buyer", 403);
  if (order.status === "created") {
    try {
      await paypal.captureOrder(order.paypalOrderId);
      logEvent({
        shields: "on", channel: "checkout", actor: order.buyerId, type: "paypal.captured", verdict: "info",
        reason: "Capture requested after buyer approval", detail: order.paypalOrderId,
      });
    } catch (err) {
      const e = err as paypal.PayPalError;
      // ORDER_ALREADY_CAPTURED is fine: fall through and reconcile.
      if (!/ALREADY_CAPTURED/i.test(e.message)) {
        throw new CheckoutError(
          /NOT_APPROVED/i.test(e.message) ? "The buyer has not approved this payment yet." : e.message,
          e.status === 422 ? 409 : e.status || 502
        );
      }
    }
  }
  return reconcile(order);
}

export async function refundOrder(orderId: string, actor: string): Promise<Order> {
  const order = findOrder(orderId);
  if (!order) throw new CheckoutError("Unknown order", 404);
  if (!order.captureId) throw new CheckoutError("Order has no captured payment to refund", 409);
  await paypal.refundCapture(order.captureId, "Refunded by the seller.");
  order.status = "refunded";
  order.updatedAt = Date.now();
  save();
  logEvent({
    shields: "on", channel: "admin", actor, type: "order.refunded", verdict: "info",
    reason: "Seller kill switch: capture refunded", detail: `${order.paypalOrderId} ${fmt(order.amount)}`,
  });
  return order;
}

/** Called by the webhook handler once PayPal has confirmed the event signature. */
export async function onVerifiedCapture(paypalOrderId: string | undefined, quoteId: string | undefined): Promise<Order | null> {
  const order =
    (paypalOrderId && findOrder(paypalOrderId)) ||
    (quoteId ? db().orders.find((o) => o.quoteId === quoteId) : undefined);
  if (!order) return null;
  order.webhookVerified = true;
  save();
  return reconcile(order);
}

export interface PaymentClaimResult {
  verified: boolean;
  reason: string;
}

/**
 * A buyer says "I've paid". Chat text, screenshots and transaction IDs prove
 * nothing; only PayPal's own records count.
 */
export async function checkPaymentClaim(args: {
  buyerId: string;
  claimedId?: string;
  runId?: string;
  channel: "chat" | "mcp" | "redteam";
}): Promise<PaymentClaimResult> {
  const mine = db().orders.filter((o) => o.buyerId === args.buyerId);
  const claimed = (args.claimedId || "").trim();
  const paid = mine.find(
    (o) => o.status === "paid" && (!claimed || o.captureId === claimed || o.paypalOrderId === claimed || o.id === claimed)
  );
  if (paid) {
    return { verified: true, reason: `Order ${paid.paypalOrderId} is verified as paid.` };
  }
  let reason = "No verified PayPal payment exists for this buyer.";
  if (claimed && paypal.paypalConfigured()) {
    try {
      const capture = await paypal.getCapture(claimed);
      reason = capture
        ? "That PayPal capture exists but is not linked to a signed quote for this buyer."
        : "PayPal has no capture with that transaction ID on this merchant account.";
    } catch {
      reason = "PayPal lookup failed, so the claim stays unverified.";
    }
  } else if (claimed) {
    reason = "No verified webhook or captured order matches that transaction ID.";
  }
  logEvent({
    shields: "on", channel: args.channel === "redteam" ? "redteam" : args.channel, actor: args.buyerId,
    type: "payment_claim.rejected", verdict: "block", reason,
    detail: claimed ? `Claimed ID ${claimed.slice(0, 40)}` : "No transaction ID given", runId: args.runId,
  });
  return { verified: false, reason };
}

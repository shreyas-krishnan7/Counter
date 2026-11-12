import crypto from "node:crypto";
import { db, getBuyer, getProduct, logEvent, save, uid } from "./store";
import { fmt } from "./money";
import type { LadderStep, Product, Quote } from "./types";

// ---------------------------------------------------------------------------
// The quote engine. Plain deterministic code; no model is involved.
//
// SECURITY INVARIANT: no function a buyer can reach reads `product.floor`.
// The floor is used exactly once, in validateLadder(), when the seller saves
// a ladder. At runtime the engine compares an offer only to the public ladder
// step the buyer currently qualifies for. Probing therefore reveals only the
// ladder, which is public anyway.
// ---------------------------------------------------------------------------

export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const MAX_DECLINES = 6;
export const LOCKOUT_MS = 10 * 60 * 1000;

export function stepPrice(product: Product, step: LadderStep): number {
  return Math.round((product.listPrice * (100 - step.percentOff)) / 100);
}

export function stepCondition(step: LadderStep): string {
  const parts: string[] = [];
  if (step.minQty && step.minQty > 1) parts.push(`buy ${step.minQty} or more`);
  if (step.returning) parts.push("returning customer (a previous PayPal-verified order)");
  if (step.clearance) parts.push("item is on clearance");
  return parts.length ? parts.join(" and ") : "anyone";
}

export interface PublicStep {
  id: string;
  label: string;
  unitPrice: number;
  condition: string;
}

/** The ladder is public by design. It never includes the floor. */
export function publicLadder(product: Product): PublicStep[] {
  return product.ladder.map((s) => ({
    id: s.id,
    label: s.label,
    unitPrice: stepPrice(product, s),
    condition: stepCondition(s),
  }));
}

export function ladderText(product: Product): string {
  return publicLadder(product)
    .map((s) => `${fmt(s.unitPrice)} each (${s.condition})`)
    .join("; ");
}

/** The ONLY place the floor is read. Called when the seller saves a product. */
export function validateLadder(product: Product): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(product.listPrice) || product.listPrice <= 0) errors.push("List price must be positive.");
  if (!Number.isInteger(product.floor) || product.floor <= 0) errors.push("Floor price must be positive.");
  if (product.floor > product.listPrice) errors.push("Floor price cannot be above the list price.");
  if (!product.ladder.length) errors.push("The ladder needs at least one step.");
  if (!product.ladder.some((s) => !s.minQty && !s.returning && !s.clearance)) {
    errors.push("The ladder needs one unconditional step (normally the list price).");
  }
  for (const s of product.ladder) {
    if (s.percentOff < 0 || s.percentOff >= 100) errors.push(`Step "${s.label}": discount must be between 0 and 99%.`);
    const price = stepPrice(product, s);
    if (price < product.floor) {
      errors.push(`Step "${s.label}" (${fmt(price)}) is below your floor (${fmt(product.floor)}).`);
    } else if (price === product.floor) {
      warnings.push(
        `Step "${s.label}" equals your floor. The ladder is public, so this makes your floor public too.`
      );
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export interface Signals {
  qty: number;
  returning: boolean;
  clearance: boolean;
}

/** Every signal is verified server-side. Nothing here comes from what a buyer says in chat. */
export function signalsFor(buyerId: string, product: Product, qty: number): Signals {
  return {
    qty,
    returning: getBuyer(buyerId).paidOrders > 0,
    clearance: product.clearance,
  };
}

function stepUnlocked(step: LadderStep, s: Signals): boolean {
  if (step.minQty && s.qty < step.minQty) return false;
  if (step.returning && !s.returning) return false;
  if (step.clearance && !s.clearance) return false;
  return true;
}

export function eligibleStep(product: Product, s: Signals): LadderStep {
  const unlocked = product.ladder.filter((step) => stepUnlocked(step, s));
  return unlocked.reduce((best, step) => (stepPrice(product, step) < stepPrice(product, best) ? step : best));
}

function canonical(q: Omit<Quote, "sig" | "status" | "createdAt">): string {
  return [q.id, q.productId, q.qty, q.unitAmount, q.total, q.currency, q.buyerId, q.stepId, q.expiresAt].join("|");
}

export function signQuote(q: Omit<Quote, "sig" | "status" | "createdAt">): string {
  return crypto.createHmac("sha256", db().secret).update(canonical(q)).digest("hex");
}

export interface QuoteRequest {
  buyerId: string;
  productId: string;
  qty: number;
  /** Optional price the buyer is offering per unit, in cents. */
  offerUnit?: number;
  channel: "chat" | "mcp" | "redteam";
  actor?: string;
  runId?: string;
}

export type QuoteResult =
  | { decision: "quote"; quote: Quote; stepLabel: string }
  | { decision: "decline"; code: "price_not_available" | "locked_out" | "invalid"; message: string };

const UNIFORM_DECLINE = "That price is not available.";

export function requestQuote(req: QuoteRequest): QuoteResult {
  const actor = req.actor || req.buyerId;
  const product = getProduct(req.productId);
  const qty = Math.floor(Number(req.qty));
  if (!product || !Number.isFinite(qty) || qty < 1 || qty > 20 || qty > product.stock) {
    logEvent({
      shields: "on", channel: "engine", actor, type: "quote.invalid", verdict: "block",
      reason: "Unknown product or quantity out of range", runId: req.runId,
    });
    return { decision: "decline", code: "invalid", message: "That product or quantity is not available." };
  }

  const key = `${req.buyerId}:${product.id}`;
  const d = db();
  const counter = d.offers[key] || { declines: 0, lockedUntil: 0 };
  if (counter.lockedUntil > Date.now()) {
    logEvent({
      shields: "on", channel: "engine", actor, type: "quote.locked", verdict: "block",
      reason: "Offer cap reached for this buyer and item", runId: req.runId,
    });
    return { decision: "decline", code: "locked_out", message: "Too many offers on this item. Try again later." };
  }

  const step = eligibleStep(product, signalsFor(req.buyerId, product, qty));
  const unit = stepPrice(product, step);

  // The comparison below is against the public ladder step. The floor is not consulted.
  if (req.offerUnit !== undefined && (!Number.isFinite(req.offerUnit) || req.offerUnit < unit)) {
    counter.declines += 1;
    if (counter.declines >= MAX_DECLINES) {
      counter.lockedUntil = Date.now() + LOCKOUT_MS;
      counter.declines = 0;
    }
    d.offers[key] = counter;
    save();
    logEvent({
      shields: "on", channel: "engine", actor, type: "quote.declined", verdict: "block",
      reason: "Offer below the buyer's current public ladder step",
      detail: `${product.name} x${qty}: offered ${Number.isFinite(req.offerUnit) ? fmt(req.offerUnit) : "?"}, ladder step "${step.label}"`,
      runId: req.runId,
    });
    return { decision: "decline", code: "price_not_available", message: UNIFORM_DECLINE };
  }

  const base = {
    id: uid("Q").toUpperCase().replace("Q_", "Q-"),
    productId: product.id,
    qty,
    unitAmount: unit,
    total: unit * qty,
    currency: "USD" as const,
    buyerId: req.buyerId,
    stepId: step.id,
    expiresAt: Date.now() + QUOTE_TTL_MS,
  };
  const quote: Quote = { ...base, sig: signQuote(base), status: "signed", createdAt: Date.now() };
  d.quotes.push(quote);
  save();
  logEvent({
    shields: "on", channel: "engine", actor, type: "quote.signed", verdict: "allow",
    reason: `Signed at ladder step "${step.label}"`,
    detail: `${quote.id}: ${product.name} x${qty} at ${fmt(unit)} = ${fmt(quote.total)}`,
    runId: req.runId,
  });
  return { decision: "quote", quote, stepLabel: step.label };
}

export type VerifyResult = { ok: true; quote: Quote } | { ok: false; reason: string };

export function verifyQuote(quoteId: string, sig: string, buyerId: string): VerifyResult {
  const quote = db().quotes.find((q) => q.id === quoteId);
  if (!quote) return { ok: false, reason: "Unknown quote" };
  const { sig: _stored, status: _status, createdAt: _created, ...base } = quote;
  void _stored; void _status; void _created;
  const expected = Buffer.from(signQuote(base), "hex");
  let given: Buffer;
  try {
    given = Buffer.from(String(sig), "hex");
  } catch {
    return { ok: false, reason: "Malformed signature" };
  }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: "Signature does not match the signed quote" };
  }
  if (quote.buyerId !== buyerId) return { ok: false, reason: "Quote belongs to a different buyer" };
  if (quote.expiresAt < Date.now()) {
    if (quote.status === "signed") { quote.status = "expired"; save(); }
    return { ok: false, reason: "Quote has expired" };
  }
  if (quote.status !== "signed" && quote.status !== "ordered") {
    return { ok: false, reason: `Quote is ${quote.status}` };
  }
  return { ok: true, quote };
}

export function quoteLine(quote: Quote): string {
  const product = getProduct(quote.productId);
  const mins = Math.max(0, Math.round((quote.expiresAt - Date.now()) / 60000));
  return `Quote ${quote.id}: ${quote.qty} × ${product?.name ?? quote.productId} at ${fmt(quote.unitAmount)} each, total ${fmt(quote.total)} (valid ${mins} min)`;
}

// ---------------------------------------------------------------------------
// LEGACY baseline, used only by the Red Team "shields off" probing run.
// This is the bug Counter fixes: accepting any offer at or above the floor
// lets a buyer find the floor by bisection from accept/reject answers alone.
// ---------------------------------------------------------------------------
export function legacyAcceptsOffer(product: Product, offerUnit: number): boolean {
  return offerUnit >= product.floor;
}

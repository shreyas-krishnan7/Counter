// Shared domain types. All money is integer cents; currency is USD.

export interface LadderStep {
  id: string;
  label: string;
  percentOff: number; // 0-100, applied to list price
  minQty?: number; // unlocks only when the quote quantity is at least this
  returning?: boolean; // unlocks only for a buyer with a PayPal-verified prior order
  clearance?: boolean; // unlocks only while the seller has flagged the item as slow-moving
}

export interface Product {
  id: string;
  name: string;
  blurb: string;
  emoji: string;
  listPrice: number;
  /** Private. Used ONLY by validateLadder() at setup time. Never read at runtime. */
  floor: number;
  stock: number;
  clearance: boolean;
  ladder: LadderStep[];
}

export type QuoteStatus = "signed" | "ordered" | "paid" | "expired" | "void";

export interface Quote {
  id: string;
  productId: string;
  qty: number;
  unitAmount: number;
  total: number;
  currency: "USD";
  buyerId: string;
  stepId: string;
  expiresAt: number;
  sig: string;
  status: QuoteStatus;
  createdAt: number;
}

export type OrderStatus =
  | "created"
  | "captured"
  | "paid"
  | "refunded"
  | "mismatch_refunded";

export interface Order {
  id: string;
  quoteId: string;
  buyerId: string;
  paypalOrderId: string;
  approveUrl?: string;
  captureId?: string;
  payerId?: string;
  amount: number;
  status: OrderStatus;
  apiVerified: boolean;
  webhookVerified: boolean;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

/** Orders created by the deliberately unguarded "shields off" agent. Kept separate on purpose. */
export interface NaiveOrder {
  id: string;
  description: string;
  amount: number;
  paid: boolean;
  paypalOrderId?: string;
  /** true when PayPal credentials were missing, so no real sandbox order exists */
  simulated: boolean;
  runId?: string;
  createdAt: number;
}

export type Verdict = "allow" | "block" | "info" | "breach";

export interface EventRow {
  id: string;
  ts: number;
  shields: "on" | "off";
  channel: "chat" | "mcp" | "checkout" | "webhook" | "redteam" | "admin" | "engine";
  actor: string;
  type: string;
  verdict: Verdict;
  reason: string;
  detail?: string;
  runId?: string;
}

export interface Buyer {
  id: string;
  payerIds: string[];
  paidOrders: number;
}

export interface OfferCounter {
  declines: number;
  lockedUntil: number;
}

export interface WebhookRecord {
  id: string;
  eventType: string;
  verified: boolean;
  ts: number;
  resourceId?: string;
}

export interface TranscriptLine {
  role: "attacker" | "seller" | "system";
  text: string;
}

export interface ProbePoint {
  n: number;
  offer: number;
  accepted: boolean;
  estimate: number;
}

export interface RedTeamRun {
  id: string;
  attack: string;
  shields: "on" | "off";
  startedAt: number;
  finishedAt: number;
  transcript: TranscriptLine[];
  breached: boolean;
  headline: string;
  detail: string;
  series?: ProbePoint[];
  trueFloor?: number;
  publicPrice?: number;
  llm: boolean;
}

export interface DB {
  secret: string;
  products: Product[];
  quotes: Quote[];
  orders: Order[];
  naiveOrders: NaiveOrder[];
  events: EventRow[];
  buyers: Record<string, Buyer>;
  offers: Record<string, OfferCounter>;
  webhooks: WebhookRecord[];
  runs: RedTeamRun[];
}

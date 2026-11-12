import { db, getProduct, logEvent } from "./store";
import { ladderText, quoteLine } from "./engine";
import { fmt } from "./money";
import { llmAvailable, quickText } from "./llm";

// The outbound filter. Every message the seller agent writes passes through
// here before a buyer sees it.
//
// Rule 1: the only amounts a buyer ever sees come from placeholders that the
//         server fills in from the catalog or from a signed quote.
// Rule 2: policy statements come from an approved allow-list.
// Rule 3: acceptance language ("deal", "agreed") needs a signed quote in the
//         same message.
// Rule 4: a small model reads the outgoing text (never the buyer's text, so
//         the buyer cannot inject it) and flags invented commitments.
// The filter fails closed: if any check trips or errors, the message is
// replaced with a safe line.

export const POLICIES: Record<string, string> = {
  returns:
    "Returns are accepted within 14 days of delivery for unused items in their original packaging. Refunds go back to the original PayPal payment.",
  shipping: "Orders ship within 2 business days. Standard shipping is included in the quoted price.",
  warranty: "Every item carries the manufacturer's 12-month limited warranty.",
};

const PLACEHOLDER = /\{\{\s*(price|ladder|quote|policy)\s*:\s*([A-Za-z0-9_-]+)\s*\}\}/g;

const AMOUNT_RULES: { re: RegExp; why: string }[] = [
  { re: /[$€£₹¥]\s?\d|\d\s?[$€£₹¥]/, why: "a currency amount" },
  { re: /\b\d+(?:[.,]\d+)?\s?(?:usd|dollars?|bucks?|cents?|eur|euros?|inr|rupees?|rs\.?|gbp|pounds?)\b/i, why: "a currency amount" },
  {
    re: /\b(?:a|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\s+(?:dollars?|bucks?|cents?)\b/i,
    why: "a spelled-out amount",
  },
  { re: /\d\s?%|\bper\s?cent\b|\bpercent\b/i, why: "a percentage discount" },
  { re: /\b(?:half[- ]price|for free|free of charge|no charge|on the house)\b/i, why: "a free or half-price offer" },
  // Any number above 20, or any decimal, could be a price. Quantities stay small.
  { re: /\b(?:\d{3,}|[3-9]\d|2[1-9])\b|\b\d+[.,]\d+\b/, why: "a number that could be a price" },
];

const POLICY_RULE =
  /\b(?:refunds?|money[- ]back|warrant(?:y|ies)|guarantee[ds]?|free shipping|free delivery|price[- ]match(?:ing)?|legally binding|binding (?:offer|agreement)|lifetime|no questions asked)\b/i;

const COMMITMENT_RULE =
  /\b(?:deal\s*[!.]|it'?s a deal|you(?:'ve| have) (?:got )?a deal|we have a deal|i (?:agree|accept)|agreed|sold\b|it'?s yours|consider it done|i(?:'ll| will) honou?r)\b/i;

const FALLBACK =
  "I can only confirm prices and terms that come from a signed quote, so I can't agree to that here. Tell me the item and quantity and I'll get you a quote you can pay with PayPal.";

export interface FilterResult {
  text: string;
  blocked: boolean;
  reasons: string[];
  raw: string;
}

function render(kind: string, id: string, buyerId: string): string | null {
  if (kind === "policy") return POLICIES[id] ?? null;
  if (kind === "price") {
    const p = getProduct(id);
    return p ? fmt(p.listPrice) : null;
  }
  if (kind === "ladder") {
    const p = getProduct(id);
    return p ? ladderText(p) : null;
  }
  if (kind === "quote") {
    const q = db().quotes.find((x) => x.id === id.toUpperCase());
    if (!q || q.buyerId !== buyerId) return null;
    if (q.status !== "signed" && q.status !== "ordered" && q.status !== "paid") return null;
    if (q.status === "signed" && q.expiresAt < Date.now()) return null;
    return quoteLine(q);
  }
  return null;
}

async function modelFlagsCommitment(described: string): Promise<{ flag: boolean; reason: string }> {
  const system = [
    "You audit ONE outgoing message from a shop's sales assistant before a customer sees it.",
    "Square-bracket tokens like [SIGNED QUOTE], [LIST PRICE], [PUBLIC PRICE LADDER] and [APPROVED POLICY] are verified by the server and are always fine.",
    "Flag the message ONLY if, outside those tokens, it does one of these:",
    "(a) states or agrees to a specific price, discount, free item or gift;",
    "(b) promises a refund, return, warranty, guarantee or price match in its own words;",
    "(c) says a payment has been received or confirmed;",
    "(d) says a deal or sale is agreed when the message contains no [SIGNED QUOTE] token.",
    "Do NOT flag any of these, they are always fine: asking the customer to pay with the PayPal button; saying an order ships after payment is completed; saying a price is not available; saying no payment was found; offering to prepare a quote; presenting a [SIGNED QUOTE]; product descriptions; greetings; questions.",
    "When unsure, do not flag.",
    'Reply with JSON only: {"flag": true|false, "reason": "short reason"}',
  ].join("\n");
  const out = await quickText(system, `Message to audit:\n<<<\n${described}\n>>>`, 1500);
  if (out === null) return { flag: true, reason: "Policy check declined to answer" };
  const match = out.match(/\{[\s\S]*\}/);
  if (!match) return { flag: true, reason: "Policy check returned no verdict" };
  const parsed = JSON.parse(match[0]) as { flag?: unknown; reason?: unknown };
  return { flag: parsed.flag !== false, reason: String(parsed.reason || "Invented commitment") };
}

export async function filterOutbound(
  raw: string,
  ctx: { buyerId: string; channel: "chat" | "mcp" | "redteam"; runId?: string }
): Promise<FilterResult> {
  const reasons: string[] = [];
  const validQuoteLines: string[] = [];
  let hasValidQuote = false;

  // 1. Resolve placeholders, remembering which were genuine.
  const rendered = raw.replace(PLACEHOLDER, (_m, kind: string, id: string) => {
    const value = render(kind, id, ctx.buyerId);
    if (value === null) {
      reasons.push(`Unknown or unauthorised reference {{${kind}:${id}}}`);
      return "";
    }
    if (kind === "quote") {
      hasValidQuote = true;
      validQuoteLines.push(value);
    }
    return value;
  });

  // 2. Deterministic checks run on the text with verified placeholders removed.
  const bare = raw.replace(PLACEHOLDER, " ");
  for (const rule of AMOUNT_RULES) {
    if (rule.re.test(bare)) {
      reasons.push(`Model text contains ${rule.why} that did not come from the catalog or a signed quote`);
      break;
    }
  }
  if (POLICY_RULE.test(bare)) reasons.push("Model text makes a policy promise outside the approved policy list");
  if (COMMITMENT_RULE.test(bare) && !hasValidQuote) {
    reasons.push("Model text agrees to a deal without a signed quote");
  }
  if (/\{\{|\}\}/.test(bare)) reasons.push("Malformed placeholder");

  // 3. Small-model check on the outgoing text only. Fails closed.
  if (!reasons.length && llmAvailable() && process.env.POLICY_LLM_CHECK !== "off" && bare.trim().length > 0) {
    const described = raw.replace(PLACEHOLDER, (_m, kind: string) =>
      kind === "quote" ? "[SIGNED QUOTE]" : kind === "price" ? "[LIST PRICE]" : kind === "ladder" ? "[PUBLIC PRICE LADDER]" : "[APPROVED POLICY]"
    );
    try {
      const verdict = await modelFlagsCommitment(described);
      if (verdict.flag) reasons.push(`Policy check: ${verdict.reason}`);
    } catch {
      reasons.push("Policy check unavailable, so the message was withheld");
    }
  }

  if (reasons.length) {
    logEvent({
      shields: "on", channel: ctx.channel, actor: "seller agent", type: "outbound.blocked", verdict: "block",
      reason: reasons[0], detail: `Model tried to say: "${raw.slice(0, 280)}"`, runId: ctx.runId,
    });
    const text = validQuoteLines.length ? `${FALLBACK}\n\nYour signed quote: ${validQuoteLines.join("\n")}` : FALLBACK;
    return { text, blocked: true, reasons, raw };
  }
  return { text: rendered.trim(), blocked: false, reasons, raw };
}

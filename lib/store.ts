import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { DB, EventRow, Product, Buyer } from "./types";

// A small file-backed store. One process, one JSON file. This keeps the demo
// zero-setup (no database to provision). It is NOT suitable for multiple
// instances; swap for Postgres before running more than one web process.

const DATA_DIR = process.env.COUNTER_DATA_DIR || path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

export function seedProducts(): Product[] {
  return [
    {
      id: "kb-k2",
      name: "Mechanical Keyboard K2",
      blurb: "Compact hot-swappable keyboard with tactile switches.",
      emoji: "⌨️",
      listPrice: 12000,
      floor: 8500,
      stock: 40,
      clearance: false,
      ladder: [
        { id: "list", label: "List price", percentOff: 0 },
        { id: "pair", label: "Buy 2 or more", percentOff: 5, minQty: 2 },
        { id: "loyal", label: "Returning customer", percentOff: 10, returning: true },
        { id: "final", label: "Returning customer buying 2 or more", percentOff: 15, returning: true, minQty: 2 },
      ],
    },
    {
      id: "hp-h1",
      name: "Studio Headphones H1",
      blurb: "Closed-back monitoring headphones. Last season's colourway.",
      emoji: "🎧",
      listPrice: 8000,
      floor: 6000,
      stock: 12,
      clearance: true,
      ladder: [
        { id: "list", label: "List price", percentOff: 0 },
        { id: "clear", label: "Clearance (slow-moving stock)", percentOff: 10, clearance: true },
        { id: "final", label: "Clearance, buy 2 or more", percentOff: 20, clearance: true, minQty: 2 },
      ],
    },
    {
      id: "lamp-arc",
      name: "Arc Desk Lamp",
      blurb: "Dimmable LED desk lamp with a weighted base.",
      emoji: "💡",
      listPrice: 4500,
      floor: 3000,
      stock: 60,
      clearance: false,
      ladder: [
        { id: "list", label: "List price", percentOff: 0 },
        { id: "pair", label: "Buy 2 or more", percentOff: 5, minQty: 2 },
        { id: "loyal", label: "Returning customer", percentOff: 8, returning: true },
      ],
    },
  ];
}

function fresh(): DB {
  return {
    secret: process.env.QUOTE_SIGNING_SECRET || crypto.randomBytes(32).toString("hex"),
    products: seedProducts(),
    quotes: [],
    orders: [],
    naiveOrders: [],
    events: [],
    buyers: {},
    offers: {},
    webhooks: [],
    runs: [],
  };
}

type G = typeof globalThis & { __counterDb?: DB; __counterSave?: NodeJS.Timeout | null };
const g = globalThis as G;

function load(): DB {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as DB;
      const base = fresh();
      const merged = { ...base, ...parsed };
      if (process.env.QUOTE_SIGNING_SECRET) merged.secret = process.env.QUOTE_SIGNING_SECRET;
      return merged;
    }
  } catch (err) {
    console.error("[counter] could not read data file, starting fresh:", err);
  }
  return fresh();
}

export function db(): DB {
  if (!g.__counterDb) g.__counterDb = load();
  return g.__counterDb;
}

export function save(): void {
  if (g.__counterSave) return;
  g.__counterSave = setTimeout(() => {
    g.__counterSave = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(db()));
    } catch (err) {
      console.error("[counter] could not persist data file:", err);
    }
  }, 150);
}

export function resetDb(): void {
  const secret = db().secret;
  g.__counterDb = { ...fresh(), secret };
  save();
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function logEvent(e: Omit<EventRow, "id" | "ts">): EventRow {
  const row: EventRow = { id: uid("ev"), ts: Date.now(), ...e };
  const d = db();
  d.events.push(row);
  if (d.events.length > 3000) d.events.splice(0, d.events.length - 3000);
  save();
  return row;
}

export function getProduct(id: string): Product | undefined {
  return db().products.find((p) => p.id === id);
}

export function getBuyer(id: string): Buyer {
  const d = db();
  if (!d.buyers[id]) d.buyers[id] = { id, payerIds: [], paidOrders: 0 };
  return d.buyers[id];
}

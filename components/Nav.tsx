"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/shop", label: "Storefront" },
  { href: "/redteam", label: "Red Team" },
  { href: "/console", label: "Seller console" },
  { href: "/connect", label: "Connect an agent" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-ink">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm text-white">C</span>
          Counter
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto text-sm">
          {LINKS.map((l) => {
            const active = path === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold ${
                  active ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <span className="badge badge-warn hidden sm:inline-flex">PayPal sandbox</span>
      </div>
    </header>
  );
}

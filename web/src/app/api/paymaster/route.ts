import { NextResponse } from "next/server";

/**
 * Proxies ERC-7677 paymaster requests to the Coinbase Developer Platform so the paymaster URL
 * (which contains an API key) never reaches the browser. Contract allowlisting is configured in
 * the CDP dashboard; we additionally restrict the methods that can be proxied.
 */
const ALLOWED = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData", "pm_sponsorUserOperation"]);

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.PAYMASTER_URL) });
}

export async function POST(req: Request) {
  const url = process.env.PAYMASTER_URL;
  if (!url) return NextResponse.json({ error: "paymaster not configured" }, { status: 503 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.method !== "string" || !ALLOWED.has(body.method)) {
    return NextResponse.json({ error: "method not allowed" }, { status: 400 });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return new NextResponse(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}

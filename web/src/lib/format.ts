export const fromWad = (v: bigint | undefined) => (v === undefined ? 0 : Number(v) / 1e18);

export function toWad(v: number): bigint {
  if (!Number.isFinite(v) || v <= 0) return 0n;
  return BigInt(Math.floor(v * 1e9)) * 10n ** 9n;
}

export function fmtPrice(v: number | undefined, digits = 4) {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtUsd(v: number | undefined, digits = 2) {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0; // avoid "-0.00"
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtCompact(v: number | undefined) {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
}

export function fmtPct(v: number | undefined, digits = 2, signed = true) {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits) + "%";
  return signed && v > 0 ? "+" + s : s;
}

export function fmtSigned(v: number | undefined, digits = 2) {
  if (v === undefined || !Number.isFinite(v)) return "—";
  if (Math.abs(v) < 0.5 * 10 ** -digits) return fmtUsd(0, digits);
  return (v > 0 ? "+" : "") + fmtUsd(v, digits);
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export const tone = (v: number) => (v > 1e-9 ? "text-long" : v < -1e-9 ? "text-short" : "text-muted");

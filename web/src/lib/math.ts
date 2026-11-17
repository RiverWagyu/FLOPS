/** Client-side mirrors of FlopsPerps math, used for order previews only (the contract is authoritative). */

export type Params = {
  openFeeBps: number;
  closeFeeBps: number;
  executionFee: number;
  maxLeverage: number;
  maintenanceBps: number;
  minCollateral: number;
};

export const DEFAULT_PARAMS: Params = {
  openFeeBps: 10,
  closeFeeBps: 10,
  executionFee: 1,
  maxLeverage: 50,
  maintenanceBps: 100,
  minCollateral: 10,
};

/** Size such that (collateral − openFee) × leverage = size, shaved slightly to avoid rounding past the cap. */
export function sizeFor(collateral: number, leverage: number, p: Params) {
  if (!(collateral > 0) || !(leverage >= 1)) return 0;
  return ((leverage * collateral) / (1 + (leverage * p.openFeeBps) / 1e4)) * 0.99999;
}

export function fillPrice(index: number, size: number, impactDepth: number, buy: boolean) {
  const impact = Math.min(size / impactDepth, 0.01);
  return buy ? index * (1 + impact) : index * (1 - impact);
}

export function liquidationPrice(o: {
  isLong: boolean;
  size: number;
  margin: number;
  entry: number;
  funding?: number;
  p: Params;
}) {
  const { isLong, size, margin, entry, p } = o;
  const funding = o.funding ?? 0;
  if (!(size > 0) || !(entry > 0)) return 0;
  const units = size / entry;
  const maint = (size * p.maintenanceBps) / 1e4;
  const cf = p.closeFeeBps / 1e4;
  const price = isLong
    ? (maint + size + funding - margin) / (units * (1 - cf))
    : (margin + size - funding - maint) / (units * (1 + cf));
  return Math.max(0, price);
}

/**
 * Simulated GPU rental prices.
 *
 * Each market's log-price deviation from its base level follows a mean-reverting random walk
 * (Ornstein–Uhlenbeck), plus:
 *   - skew drift: net trader open interest (longs − shorts, as a fraction of the pool) pushes the
 *     price toward the crowded side; mean reversion makes the effect fade once the skew goes away.
 *   - demand events: rare fictional news shocks that ramp in over ~20s and decay with a 30 min half-life.
 */

export type SimMarket = { symbol: string; base: number; vol: number };
export type NewsEvent = { market: number; headline: string; impact: number; ts: number };

const SIGMA = 0.01 / Math.sqrt(3600); // ≈1% hourly volatility at vol = 1
const THETA = Math.LN2 / (6 * 3600); // 6h half-life back to base
const KAPPA = 2.8e-5; // net OI of 10% of pool ⇒ ~+1%/h drift
const EVENT_RATE = 1 / 3600; // about one news event per hour across all markets
const SHOCK_RISE = 20;
const SHOCK_HALF_LIFE = 20 * 60;
const MAX_DEV = 0.5; // price stays within ~0.6x–1.65x of base

const UP = [
  "Frontier lab books a 20k-GPU {gpu} cluster for a new training run",
  "Datacenter outage takes {gpu} capacity offline in us-east",
  "Open-weights model release sparks a {gpu} fine-tuning rush",
  "Sovereign AI fund pre-buys a year of {gpu} capacity",
  "Cooling failure idles a major {gpu} farm",
];
const DOWN = [
  "Hyperscaler brings 50k new {gpu} online",
  "{gpu} rental glut as a big training run ends early",
  "Next-gen chip announcement cools {gpu} demand",
  "Crypto miners pivot idle rigs to {gpu} rentals",
  "Inference startup returns unused {gpu} reservations",
];

type Shock = { market: number; target: number; age: number };

export type Rng = () => number;

export class PriceSimulator {
  private x: number[];
  private shocks: Shock[] = [];
  constructor(
    readonly markets: readonly SimMarket[],
    private rng: Rng = Math.random,
  ) {
    this.x = markets.map(() => 0);
  }

  /** Align the simulator with an existing (e.g. on-chain) price. */
  setPrice(market: number, price: number) {
    this.x[market] = Math.log(price / this.markets[market].base) - this.shockSum(market);
  }

  prices(): number[] {
    return this.markets.map((m, i) => {
      const dev = Math.max(-MAX_DEV, Math.min(MAX_DEV, this.x[i] + this.shockSum(i)));
      return m.base * Math.exp(dev);
    });
  }

  /**
   * Advance by `dt` seconds.
   * @param skews net open interest per market as a fraction of pool assets (−1..1)
   */
  step(dt: number, skews: number[] = [], now = Date.now()): { prices: number[]; events: NewsEvent[] } {
    const events: NewsEvent[] = [];
    for (let i = 0; i < this.markets.length; i++) {
      const skew = Math.max(-1, Math.min(1, skews[i] ?? 0));
      const noise = SIGMA * this.markets[i].vol * Math.sqrt(dt) * this.gauss();
      let x = this.x[i] - THETA * this.x[i] * dt + KAPPA * skew * dt + noise;
      this.x[i] = Math.max(-MAX_DEV, Math.min(MAX_DEV, x));
    }
    for (const s of this.shocks) s.age += dt;
    this.shocks = this.shocks.filter((s) => s.age < SHOCK_RISE + 5 * SHOCK_HALF_LIFE);

    if (this.rng() < EVENT_RATE * dt) events.push(this.spawnEvent(now));
    return { prices: this.prices(), events };
  }

  private spawnEvent(now: number): NewsEvent {
    const market = Math.floor(this.rng() * this.markets.length);
    const up = this.rng() < 0.5;
    const magnitude = 0.03 + this.rng() * 0.05; // 3–8%
    const target = Math.log(1 + (up ? magnitude : -magnitude));
    this.shocks.push({ market, target, age: 0 });
    const pool = up ? UP : DOWN;
    const headline = pool[Math.floor(this.rng() * pool.length)].replace("{gpu}", this.markets[market].symbol);
    return { market, headline, impact: up ? magnitude : -magnitude, ts: now };
  }

  private shockSum(market: number): number {
    let sum = 0;
    for (const s of this.shocks) {
      if (s.market !== market) continue;
      const rise = Math.min(1, s.age / SHOCK_RISE);
      const decay = Math.pow(0.5, Math.max(0, s.age - SHOCK_RISE) / SHOCK_HALF_LIFE);
      sum += s.target * rise * decay;
    }
    return sum;
  }

  private spare: number | null = null;
  private gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = this.rng();
    const v = this.rng();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

export type Candle = { t: number; o: number; h: number; l: number; c: number };

/**
 * Generate `days` of 1-minute candles for every market so charts have history on first boot.
 * Each series is rescaled so its last close equals `endPrices[i]`.
 */
export function backfill(
  markets: readonly SimMarket[],
  endPrices: number[],
  days: number,
  endSec: number,
  rng: Rng = Math.random,
): { candles: Candle[][]; events: NewsEvent[] } {
  const sim = new PriceSimulator(markets, rng);
  const minutes = Math.floor((days * 86400) / 60);
  const startMin = Math.floor(endSec / 60) - minutes;
  const candles: Candle[][] = markets.map(() => []);
  const events: NewsEvent[] = [];
  const STEP = 4; // seconds per sub-step
  for (let m = 0; m < minutes; m++) {
    const t = (startMin + m) * 60;
    const cur = sim.prices().map((p) => ({ t, o: p, h: p, l: p, c: p }));
    for (let s = 0; s < 60 / STEP; s++) {
      const r = sim.step(STEP, [], (t + s * STEP) * 1000);
      events.push(...r.events);
      r.prices.forEach((p, i) => {
        cur[i].h = Math.max(cur[i].h, p);
        cur[i].l = Math.min(cur[i].l, p);
        cur[i].c = p;
      });
    }
    cur.forEach((c, i) => candles[i].push(c));
  }
  candles.forEach((series, i) => {
    const k = endPrices[i] / series[series.length - 1].c;
    for (const c of series) {
      c.o *= k;
      c.h *= k;
      c.l *= k;
      c.c *= k;
    }
  });
  return { candles, events };
}

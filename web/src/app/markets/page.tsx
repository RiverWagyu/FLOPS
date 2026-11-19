"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api, type Candle, type MarketState } from "@/lib/api";
import { useLive } from "@/lib/live";
import { MARKETS } from "@/lib/markets";
import { computeIndex, indexChange, indexSeries, spread } from "@/lib/computeIndex";
import { fmtCompact, fmtPct, fmtPrice, tone } from "@/lib/format";
import { Empty, Panel, PanelHeader, Stat, Tabs } from "@/components/ui";
import { LineChart, Sparkline } from "@/components/LineChart";
import { NewsFeed } from "@/components/Feeds";

const RANGES = {
  "24h": { tf: 900, limit: 96, label: "24h" },
  "7d": { tf: 3600, limit: 168, label: "7d" },
} as const;
type Range = keyof typeof RANGES;

const NO_CANDLES: Candle[] = [];
// Defined outside the component so React Query can memoize the combined result: the charts
// then only redraw when new candles arrive, not on every live price tick.
const combineCandles = (results: { data?: Candle[] }[]) => ({
  candles: results.map((r) => r.data ?? NO_CANDLES),
  loaded: results.every((r) => r.data !== undefined),
});

export default function MarketsPage() {
  const { markets } = useLive();
  const [range, setRange] = useState<Range>("24h");
  const { tf, limit } = RANGES[range];

  const { candles, loaded } = useQueries({
    queries: MARKETS.map((m) => ({
      queryKey: ["candles", m.id, tf, limit],
      queryFn: () => api<Candle[]>(`/api/candles?market=${m.id}&tf=${tf}&limit=${limit}`),
      refetchInterval: 60_000,
    })),
    combine: combineCandles,
  });

  const series = useMemo(() => indexSeries(candles), [candles]);
  const ready = markets.length === MARKETS.length;
  const prices = markets.map((m) => m.price);
  const index = ready ? computeIndex(prices) : null;
  const change = ready ? indexChange(prices, markets.map((m) => m.change24h)) : null;
  // Extend the chart to the live index, rounded to the minute so the chart redraws at most once a minute.
  const minute = Math.floor(Date.now() / 60_000) * 60;
  const liveIndex = index === null ? null : Math.round(index * 100) / 100;
  const live = useMemo(() => {
    if (liveIndex === null || series.length === 0 || minute <= series[series.length - 1].t) return series;
    return [...series, { t: minute, value: liveIndex }];
  }, [series, liveIndex, minute]);

  return (
    <div className="mx-auto mt-4 flex max-w-6xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">GPU Market Index</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The price of AI compute in one place: hourly rental prices for every GPU on FLOPS, how they moved, and the
          news behind the moves. Prices and news are simulated on this testnet.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <Panel className="flex h-[360px] flex-col">
          <PanelHeader right={<Tabs value={range} onChange={setRange} items={(Object.keys(RANGES) as Range[]).map((r) => ({ value: r, label: RANGES[r].label }))} />}>
            FLOPS Compute Index
          </PanelHeader>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2 px-4 pt-3">
            <div>
              <div className="num text-3xl font-semibold">{index === null ? "—" : index.toFixed(2)}</div>
              <div className={`num text-sm ${tone(change ?? 0)}`}>{fmtPct(change ?? undefined)} 24h</div>
            </div>
            <p className="max-w-sm pb-1 text-[11px] leading-relaxed text-muted">
              Average of all four GPUs&apos; prices against their launch prices. 100 = launch level; 110 = compute costs
              10% more than at launch.
            </p>
          </div>
          <div className="relative min-h-0 flex-1">
            <LineChart data={live} precision={2} />
            {loaded && series.length < 2 && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">History builds up as the market runs</div>
            )}
          </div>
        </Panel>
        <Heatmap markets={markets} />
      </div>

      <MarketTable markets={markets} candles={candles} />

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <SpreadPanel markets={markets} candles={candles} />
        <div className="flex h-[340px] flex-col [&>section]:min-h-0 [&>section]:flex-1">
          <NewsFeed />
        </div>
      </div>
    </div>
  );
}

/** Tiles colored by 24h change: greener = more expensive than yesterday, redder = cheaper. */
function Heatmap({ markets }: { markets: MarketState[] }) {
  return (
    <Panel className="flex flex-col">
      <PanelHeader right={<span className="text-[10px] text-muted">24h change</span>}>Heatmap</PanelHeader>
      <div className="grid flex-1 grid-cols-2 gap-2 p-3">
        {MARKETS.map((meta) => {
          const m = markets[meta.id];
          const ch = m?.change24h ?? 0;
          const strength = Math.min(Math.abs(ch) / 0.1, 1); // full color at ±10%
          const color = ch >= 0 ? "var(--color-long)" : "var(--color-short)";
          return (
            <Link
              key={meta.id}
              href={`/trade/${meta.symbol}`}
              className="flex min-h-[120px] flex-col justify-between rounded-md border border-line p-3 transition-transform hover:scale-[1.02]"
              style={{ background: `color-mix(in srgb, ${color} ${Math.round(8 + strength * 47)}%, var(--color-panel-2))` }}
              title={`Trade ${meta.symbol}`}
            >
              <div>
                <div className="text-sm font-semibold">{meta.symbol}</div>
                <div className="text-[11px] text-fg/70">{meta.tier}</div>
              </div>
              <div>
                <div className="num text-lg font-semibold">{m ? fmtPrice(m.price) : "—"}</div>
                <div className="num text-xs">{m ? fmtPct(ch) : "—"}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function MarketTable({ markets, candles }: { markets: MarketState[]; candles: Candle[][] }) {
  const th = "px-3 py-2 font-medium";
  const td = "num px-3 py-2 text-xs";
  return (
    <Panel className="overflow-x-auto">
      <PanelHeader>All GPUs · tUSD per GPU-hour</PanelHeader>
      {markets.length === 0 ? (
        <Empty>Connecting to the price feed…</Empty>
      ) : (
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-muted">
              <th className={th}>GPU</th>
              <th className={`${th} text-right`}>Price</th>
              <th className={`${th} text-right`}>24h</th>
              <th className={`${th} text-right`}>24h high / low</th>
              <th className={`${th} text-right`}>24h volume</th>
              <th className={`${th} text-right`}>Funding / h</th>
              <th className={`${th} text-right`}>Open interest L / S</th>
              <th className={th}>Trend</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((meta) => {
              const m = markets[meta.id];
              if (!m) return null;
              return (
                <tr key={meta.id} className="border-b border-line/60 last:border-0 hover:bg-panel-2">
                  <td className="px-3 py-2">
                    <div className="text-sm font-semibold">{meta.symbol}</div>
                    <div className="text-[11px] text-muted">
                      {meta.vram} · {meta.tier}
                    </div>
                  </td>
                  <td className={`${td} text-right text-sm`}>{fmtPrice(m.price)}</td>
                  <td className={`${td} text-right ${tone(m.change24h)}`}>{fmtPct(m.change24h)}</td>
                  <td className={`${td} text-right text-muted`}>
                    {fmtPrice(m.high24h)} / {fmtPrice(m.low24h)}
                  </td>
                  <td className={`${td} text-right`}>{fmtCompact(m.volume24h)}</td>
                  <td className={`${td} text-right ${tone(-m.fundingRatePerHour)}`} title="Positive: longs pay shorts">
                    {fmtPct(m.fundingRatePerHour, 4)}
                  </td>
                  <td className={`${td} text-right`}>
                    <span className="text-long">{fmtCompact(m.longOI)}</span> / <span className="text-short">{fmtCompact(m.shortOI)}</span>
                  </td>
                  <td className="px-3 py-1">
                    <Sparkline values={(candles[meta.id] ?? []).map((c) => c.c)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/trade/${meta.symbol}`} className="rounded bg-panel-3 px-3 py-1 text-xs hover:bg-accent">
                      Trade
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** H100 vs A100: is the newest chip getting more or less expensive relative to the older one? */
function SpreadPanel({ markets, candles }: { markets: MarketState[]; candles: Candle[][] }) {
  const h = markets[0];
  const a = markets[1];
  const now = h && a ? spread(h.price, a.price) : null;
  const history = useMemo(() => {
    const aBy = new Map((candles[1] ?? []).map((c) => [c.t, c.c]));
    return (candles[0] ?? []).flatMap((c) => {
      const s = spread(c.c, aBy.get(c.t) ?? 0);
      return s ? [{ t: c.t, value: s.ratio }] : [];
    });
  }, [candles]);
  const first = history[0]?.value;
  const moved = now && first ? now.ratio / first - 1 : undefined;
  return (
    <Panel className="flex h-[340px] flex-col">
      <PanelHeader>H100 vs A100 spread</PanelHeader>
      <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 pt-3">
        <Stat label="Price gap (tUSD / hour)" value={now ? fmtPrice(now.gap) : "—"} />
        <Stat label="H100 costs" value={now ? `${now.ratio.toFixed(2)}× an A100` : "—"} />
        <Stat label="Ratio change (range)" value={<span className={tone(moved ?? 0)}>{fmtPct(moved)}</span>} />
      </div>
      <p className="px-4 pt-2 text-[11px] leading-relaxed text-muted">
        A rising ratio means demand is shifting to the newest chips; a falling one means older GPUs are catching up.
      </p>
      <div className="relative min-h-0 flex-1">
        <LineChart data={history} precision={3} color="#f5b84b" />
      </div>
    </Panel>
  );
}

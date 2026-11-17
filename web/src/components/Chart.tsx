"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, type Candle } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { Tabs } from "./ui";

const TFS = [
  { value: "60", label: "1m" },
  { value: "300", label: "5m" },
  { value: "900", label: "15m" },
  { value: "3600", label: "1h" },
  { value: "14400", label: "4h" },
  { value: "86400", label: "1D" },
] as const;

type Tf = (typeof TFS)[number]["value"];
export type ChartLine = { price: number; color: string; title: string };

const css = (name: string) =>
  typeof window === "undefined" ? "#888" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function Chart({ marketId, lines = [] }: { marketId: number; lines?: ChartLine[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const last = useRef<Candle | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const [tf, setTf] = useState<Tf>("60");
  const [loading, setLoading] = useState(true);

  // create chart once
  useEffect(() => {
    if (!el.current) return;
    const up = css("--color-long");
    const down = css("--color-short");
    const c = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--color-muted"),
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: css("--color-line") },
      timeScale: { borderColor: css("--color-line"), timeVisible: true, secondsVisible: false },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
    });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" } });
    volume.current.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, []);

  // load history on market / timeframe change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<Candle[]>(`/api/candles?market=${marketId}&tf=${tf}&limit=600`)
      .then((rows) => {
        if (cancelled || !candles.current || !volume.current) return;
        candles.current.setData(rows.map((r) => ({ time: r.t as UTCTimestamp, open: r.o, high: r.h, low: r.l, close: r.c })));
        volume.current.setData(
          rows.map((r) => ({
            time: r.t as UTCTimestamp,
            value: r.v,
            color: r.c >= r.o ? "rgba(47,191,138,0.35)" : "rgba(240,80,110,0.35)",
          })),
        );
        last.current = rows.at(-1) ?? null;
        chart.current?.timeScale().scrollToRealTime();
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [marketId, tf]);

  // live updates
  useLiveEvent((e) => {
    if (e.type !== "tick" || !candles.current) return;
    const price = e.prices[marketId];
    if (price === undefined) return;
    const step = Number(tf);
    const t = Math.floor(e.t / 1000 / step) * step;
    const prev = last.current;
    const next: Candle =
      prev && prev.t === t
        ? { ...prev, h: Math.max(prev.h, price), l: Math.min(prev.l, price), c: price }
        : { t, o: prev?.c ?? price, h: Math.max(price, prev?.c ?? price), l: Math.min(price, prev?.c ?? price), c: price, v: 0 };
    if (prev && t < prev.t) return;
    last.current = next;
    candles.current.update({ time: t as UTCTimestamp, open: next.o, high: next.h, low: next.l, close: next.c });
  });

  // position / order lines
  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    const s = candles.current;
    if (!s) return;
    priceLines.current.forEach((l) => s.removePriceLine(l));
    priceLines.current = lines
      .filter((l) => l.price > 0)
      .map((l) =>
        s.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: l.title }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-line px-2">
        <Tabs value={tf} onChange={setTf} items={TFS.map((t) => ({ value: t.value, label: t.label }))} />
        {loading && <span className="text-[11px] text-muted">loading…</span>}
      </div>
      <div ref={el} className="min-h-0 flex-1" />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, type Candle } from "@/lib/api";
import { bollinger, ema, rsi, sma } from "@/lib/indicators";
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

/** Indicator toggles shown above the chart; the choice is remembered per browser. */
const INDICATORS = [
  { key: "ma20", label: "MA 20", color: "#f5b84b" },
  { key: "ma50", label: "MA 50", color: "#4ea8ff" },
  { key: "ema20", label: "EMA 20", color: "#e879f9" },
  { key: "bb", label: "BB", color: "#a594ff" },
  { key: "rsi", label: "RSI", color: "#a594ff" },
  { key: "vol", label: "Vol", color: "#7d8794" },
] as const;
type IndKey = (typeof INDICATORS)[number]["key"];
const IND_STORE = "flops.indicators";
const IND_DEFAULT: IndKey[] = ["ma20", "vol"];

function loadIndicators(): Set<IndKey> {
  try {
    const saved = JSON.parse(localStorage.getItem(IND_STORE) ?? "null");
    if (Array.isArray(saved)) return new Set(saved.filter((k) => INDICATORS.some((i) => i.key === k)));
  } catch {
    /* storage unavailable: use defaults */
  }
  return new Set(IND_DEFAULT);
}

type LineApi = ISeriesApi<"Line">;
/** Indicator series by id; Bollinger Bands use three lines. */
type IndSeries = Partial<Record<"ma20" | "ma50" | "ema20" | "bbU" | "bbM" | "bbL" | "rsi", LineApi>>;
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
  const bars = useRef<Candle[]>([]);
  const ind = useRef<IndSeries>({});
  const [active, setActive] = useState<Set<IndKey>>(loadIndicators);

  /** Recomputes every visible indicator from `bars`; `lastOnly` just moves the newest point. */
  const drawIndicators = useCallback((lastOnly = false) => {
    const rows = bars.current;
    if (!rows.length) return;
    const closes = rows.map((r) => r.c);
    const put = (s: LineApi | undefined, values: (number | null)[]) => {
      if (!s) return;
      const point = (i: number) =>
        values[i] === null ? { time: rows[i].t as UTCTimestamp } : { time: rows[i].t as UTCTimestamp, value: values[i] as number };
      if (lastOnly) s.update(point(rows.length - 1));
      else s.setData(rows.map((_, i) => point(i)));
    };
    const s = ind.current;
    put(s.ma20, sma(closes, 20));
    put(s.ma50, sma(closes, 50));
    put(s.ema20, ema(closes, 20));
    if (s.bbM) {
      const bb = bollinger(closes, 20, 2);
      put(s.bbU, bb.upper);
      put(s.bbM, bb.mid);
      put(s.bbL, bb.lower);
    }
    put(s.rsi, rsi(closes, 14));
  }, []);

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
    ind.current = {}; // indicator lines belong to a chart; a new chart starts without any
    return () => {
      c.remove();
      chart.current = null;
      ind.current = {};
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
        bars.current = rows.slice();
        drawIndicators();
        chart.current?.timeScale().scrollToRealTime();
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [marketId, tf, drawIndicators]);

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
    const rows = bars.current;
    if (rows.at(-1)?.t === t) rows[rows.length - 1] = next;
    else rows.push(next);
    drawIndicators(true);
  });

  // add / remove indicator series when toggled
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const s = ind.current;
    const line = (color: string, pane = 0, width: 1 | 2 = 1) =>
      c.addSeries(
        LineSeries,
        { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
        pane,
      );
    const drop = (...ids: (keyof IndSeries)[]) =>
      ids.forEach((id) => {
        const series = s[id];
        if (series) c.removeSeries(series);
        delete s[id];
      });
    const want = (k: IndKey) => active.has(k);
    const color = (k: IndKey) => INDICATORS.find((i) => i.key === k)!.color;

    for (const k of ["ma20", "ma50", "ema20"] as const) {
      if (want(k) && !s[k]) s[k] = line(color(k), 0, 2);
      if (!want(k)) drop(k);
    }
    if (want("bb") && !s.bbM) {
      s.bbU = line(color("bb"));
      s.bbM = line(color("bb"));
      s.bbM.applyOptions({ lineStyle: LineStyle.Dotted });
      s.bbL = line(color("bb"));
    }
    if (!want("bb")) drop("bbU", "bbM", "bbL");
    if (want("rsi") && !s.rsi) {
      s.rsi = line(color("rsi"), 1, 2);
      s.rsi.applyOptions({ lastValueVisible: true, priceFormat: { type: "price", precision: 1, minMove: 0.1 } });
      for (const level of [70, 30]) {
        s.rsi.createPriceLine({ price: level, color: "#3a4350", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      }
      c.panes()[1]?.setStretchFactor(0.3);
    }
    if (!want("rsi") && s.rsi) {
      drop("rsi");
      if (c.panes().length > 1) c.removePane(1);
    }
    volume.current?.applyOptions({ visible: want("vol") });
    drawIndicators();
    try {
      localStorage.setItem(IND_STORE, JSON.stringify([...active]));
    } catch {
      /* storage unavailable: the choice just isn't remembered */
    }
  }, [active, drawIndicators]);

  const toggle = (k: IndKey) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
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
      <div className="flex h-9 items-center gap-3 overflow-x-auto border-b border-line px-2">
        <Tabs value={tf} onChange={setTf} items={TFS.map((t) => ({ value: t.value, label: t.label }))} />
        <div className="h-4 w-px shrink-0 bg-line" />
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Indicators">
          {INDICATORS.map((i) => {
            const on = active.has(i.key);
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(i.key)}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${on ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? i.color : "transparent", boxShadow: `inset 0 0 0 1px ${i.color}` }} />
                {i.label}
              </button>
            );
          })}
        </div>
        {loading && <span className="ml-auto shrink-0 text-[11px] text-muted">loading…</span>}
      </div>
      <div ref={el} className="min-h-0 flex-1" />
    </div>
  );
}

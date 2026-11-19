"use client";

import { useEffect, useRef } from "react";
import { ColorType, LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";

type Point = { t: number; value: number };

/** A minimal themed line chart (lightweight-charts). `t` is unix seconds. */
export function LineChart({ data, precision = 2, color }: { data: Point[]; precision?: number; color?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--color-muted"),
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#161b22" }, horzLines: { color: "#161b22" } },
      rightPriceScale: { borderColor: css("--color-line") },
      timeScale: { borderColor: css("--color-line"), timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    series.current = chart.addSeries(LineSeries, {
      color: color ?? css("--color-accent"),
      lineWidth: 2,
      priceFormat: { type: "price", precision, minMove: 10 ** -precision },
    });
    return () => {
      series.current = null;
      chart.remove();
    };
  }, [precision, color]);

  useEffect(() => {
    series.current?.setData(data.map((p) => ({ time: p.t as UTCTimestamp, value: p.value })));
  }, [data, precision, color]);

  return <div ref={el} className="absolute inset-0" />;
}

/** Tiny inline trend line for tables. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="inline-block text-[11px] text-muted" style={{ width }}>—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="inline-block">
      <polyline points={pts} fill="none" strokeWidth={1.5} stroke={up ? "var(--color-long)" : "var(--color-short)"} />
    </svg>
  );
}

"use client";

import { useState } from "react";

// recharts is not a dependency in this repo, so the historical PSF trend is
// drawn as a lightweight responsive SVG line chart with a hover tooltip.

type PricePoint = {
  quarter: string;
  avg_psf: number;
  transaction_count: number;
};

const NAVY = "#1A2942";

// "2020-01-01" -> "Q1 2020"
function formatQuarter(quarter: string): string {
  const date = new Date(quarter);
  if (Number.isNaN(date.getTime())) return quarter;
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `Q${q} ${date.getUTCFullYear()}`;
}

function formatPsf(value: number): string {
  return `$${Math.round(value).toLocaleString("en-SG")}`;
}

export default function ProjectPriceChart({ data }: { data: PricePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data || data.length < 2) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-[#d8c7ad] bg-[#fbf7ef] px-6 text-center text-sm text-[#71695d]">
        Insufficient price data for this project
      </div>
    );
  }

  // viewBox coordinate space; the SVG scales responsively to its container.
  const width = 720;
  const height = 280;
  const padding = { top: 24, right: 24, bottom: 44, left: 64 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const psfValues = data.map((d) => d.avg_psf);
  const minPsf = Math.min(...psfValues);
  const maxPsf = Math.max(...psfValues);
  // Pad the domain a touch so the line never sits on the top/bottom axis.
  const domainMin = Math.floor((minPsf - (maxPsf - minPsf) * 0.1) / 50) * 50;
  const domainMax = Math.ceil((maxPsf + (maxPsf - minPsf) * 0.1) / 50) * 50;
  const domainSpan = Math.max(1, domainMax - domainMin);

  const xFor = (i: number) =>
    padding.left + (data.length === 1 ? plotWidth / 2 : (i / (data.length - 1)) * plotWidth);
  const yFor = (psf: number) =>
    padding.top + plotHeight - ((psf - domainMin) / domainSpan) * plotHeight;

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(d.avg_psf).toFixed(1)}`)
    .join(" ");

  const areaPath =
    `M ${xFor(0).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} ` +
    data.map((d, i) => `L ${xFor(i).toFixed(1)} ${yFor(d.avg_psf).toFixed(1)}`).join(" ") +
    ` L ${xFor(data.length - 1).toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`;

  // Horizontal gridlines / Y labels at 4 evenly spaced ticks.
  const yTicks = Array.from({ length: 4 }, (_, i) => domainMin + (domainSpan * i) / 3);

  // Cap X labels to avoid crowding; always keep first and last.
  const maxXLabels = 6;
  const xLabelStep = Math.max(1, Math.ceil(data.length / maxXLabels));

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[280px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Historical average PSF line chart"
      >
        {/* Y gridlines + labels */}
        {yTicks.map((tick, i) => {
          const y = yFor(tick);
          return (
            <g key={`y-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e7dcc8"
                strokeWidth={1}
              />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" fontSize={11} fill="#71695d">
                {formatPsf(tick)}
              </text>
            </g>
          );
        })}

        {/* Area fill under the line */}
        <path d={areaPath} fill={NAVY} fillOpacity={0.06} />

        {/* The trend line */}
        <path d={linePath} fill="none" stroke={NAVY} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* Data points + hover targets */}
        {data.map((d, i) => {
          const cx = xFor(i);
          const cy = yFor(d.avg_psf);
          const active = hover === i;
          return (
            <g key={`pt-${i}`}>
              <circle cx={cx} cy={cy} r={active ? 5 : 3} fill={NAVY} />
              {/* Wide invisible hit area for easier hovering */}
              <rect
                x={cx - plotWidth / (data.length * 2 || 1)}
                y={padding.top}
                width={Math.max(8, plotWidth / (data.length || 1))}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        {/* X labels */}
        {data.map((d, i) => {
          if (i % xLabelStep !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={`x-${i}`}
              x={xFor(i)}
              y={height - padding.bottom + 20}
              textAnchor="middle"
              fontSize={11}
              fill="#71695d"
            >
              {formatQuarter(d.quarter)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hover !== null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-[#1A2942] px-3 py-2 text-xs font-medium text-white shadow-lg"
          style={{
            left: `${(xFor(hover) / width) * 100}%`,
            top: `${(yFor(data[hover].avg_psf) / height) * 100}%`,
          }}
        >
          {formatQuarter(data[hover].quarter)}: {formatPsf(data[hover].avg_psf)} psf
          <span className="block text-[11px] font-normal text-[#c9b892]">
            {data[hover].transaction_count} transaction{data[hover].transaction_count === 1 ? "" : "s"}
          </span>
        </div>
      )}
    </div>
  );
}

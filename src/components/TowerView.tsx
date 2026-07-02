"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDistrict, formatTenure } from "@/lib/projects";

type Tx = {
  price: number;
  date: string;
  psf: number;
  sqm: number;
  sqft: number;
  type: string | null;
};

type Unit = {
  unit: string;
  transactionCount: number;
  status: string;
  latestTx: Tx | null;
  previousTx: Tx | null;
  firstTx: Tx | null;
  profitable: boolean | null;
  profitAmount: number | null;
  profitPct: number | null;
  ssdStatus: "cleared" | "in_period" | "no_data";
  ssdRate: number;
  ssdAmount: number;
  ssdClearsDate: string | null;
  allTransactions: Tx[];
};

type TowerData = {
  projectName: string;
  district: string | null;
  tenure: string | null;
  totalUnits: number | null;
  blocks: string[];
  selectedBlock: string;
  floors: Record<string, Record<string, Unit>>;
  maxFloor: number;
  minFloor: number;
  stacks: number[];
};

type StatusStyle = { bg: string; text: string; border: string };
const STATUS_STYLES: Record<string, StatusStyle> = {
  profitable_clear: { bg: "#1A2942", text: "#FFFFFF", border: "#2d4a6b" }, // NexDoor navy
  profitable_ssd: { bg: "#C9A96E", text: "#FFFFFF", border: "#b8935a" }, // NexDoor gold
  unprofitable: { bg: "#B84C30", text: "#FFFFFF", border: "#a03d24" }, // NexDoor terracotta
  single_tx: { bg: "#64748b", text: "#FFFFFF", border: "#4f6070" }, // slate grey
  no_data: { bg: "#EDE4D8", text: "#1A2942", border: "#d4c9b8" }, // NexDoor cream
};
const PROFIT_TEXT = "#FFFFFF"; // white — visible on navy/gold/terracotta
const LOSS_TEXT = "#ffe0d9"; // light tint — visible on terracotta

const fmtMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `$${Math.round(n).toLocaleString("en-SG")}`;

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-SG", { month: "short", year: "numeric" });
};

const fmtSigned = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-SG")}`;
const fmtPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;

// Compact price for the tower cells: $2.98M / $850K / $12,345.
function formatPrice(price: number | null | undefined): string {
  if (!price) return "—";
  if (price >= 1_000_000) return `$${(price / 1_000_000).toFixed(2)}M`;
  if (price >= 100_000) return `$${(price / 1000).toFixed(0)}K`;
  return `$${Math.round(price).toLocaleString("en-SG")}`;
}

function yearsHeldFrom(date: string): number {
  return (Date.now() - new Date(date).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

export default function TowerView({ slug }: { slug: string }) {
  const [data, setData] = useState<TowerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [block, setBlock] = useState<string | null>(null); // null = let API pick first
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    const qs = block ? `?block=${encodeURIComponent(block)}` : "";
    fetch(`/api/projects/${encodeURIComponent(slug)}/tower${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then((d: TowerData) => {
        if (!active) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, block]);

  const projectName = data?.projectName || decodeURIComponent(slug);

  // Floors high → low for the tower render.
  const floorNumbers = useMemo(() => {
    if (!data) return [];
    const list: number[] = [];
    for (let f = data.maxFloor; f >= data.minFloor; f -= 1) list.push(f);
    return list;
  }, [data]);

  return (
    <main className="min-h-screen bg-[#EDE4D8]/40">
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        {/* Breadcrumb */}
        <a
          href="/projects"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#B84C30] transition hover:underline"
        >
          ← Back to {projectName}
        </a>

        {/* Header */}
        <header className="mt-4">
          <h1 className="font-[family-name:var(--font-playfair)] text-2xl font-bold tracking-tight text-[#1A2942] sm:text-3xl">
            {projectName} — Tower View
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#71695d]">
            <span>{formatDistrict(data?.district)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTenure(data?.tenure)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {data?.totalUnits != null ? `${data.totalUnits.toLocaleString("en-SG")} units` : "— units"}
            </span>
          </div>
        </header>

        {loading ? (
          <TowerSkeleton />
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-dashed border-[#d8c7ad] bg-white px-6 py-12 text-center text-sm text-[#71695d]">
            Unable to load tower data. Please try again.
          </div>
        ) : !data || data.blocks.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-[#d8c7ad] bg-white px-6 py-12 text-center text-sm text-[#71695d]">
            No unit-level transaction data available for this project.
          </div>
        ) : (
          <>
            {/* Block selector */}
            <section className="mt-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a9894f]">Select Block</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.blocks.map((b) => {
                  const isActive = b === data.selectedBlock;
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => {
                        setSelectedUnit(null);
                        setBlock(b);
                      }}
                      className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
                        isActive
                          ? "border-[#1A2942] bg-[#1A2942] text-white"
                          : "border-[#e7dcc8] bg-white text-[#1A2942] hover:border-[#a9894f]"
                      }`}
                    >
                      Blk {b}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[#a9894f]">
                Note: Blocks without unit-level transaction data are not shown.
              </p>
            </section>

            {/* Legend */}
            <section className="mt-6">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#71695d]">
                <LegendDot style={STATUS_STYLES.profitable_clear} label="Profitable, SSD cleared" />
                <LegendDot style={STATUS_STYLES.profitable_ssd} label="Profitable, in SSD period" />
                <LegendDot style={STATUS_STYLES.unprofitable} label="Unprofitable" />
                <LegendDot style={STATUS_STYLES.single_tx} label="1 transaction" />
                <LegendDot style={STATUS_STYLES.no_data} label="No data" />
              </div>
              <p className="mt-2 text-[10px] text-[#a9894f]">HV↗ = Get estimated value on HomeValue</p>
            </section>

            {/* Tower + detail panel */}
            <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start">
              {/* Tower grid */}
              <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-[#e7dcc8] bg-white p-4">
                <div className="inline-block">
                  {/* Stack number header (sticky at top) */}
                  <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-white pb-1">
                    <span className="w-11 shrink-0" />
                    {data.stacks.map((stack) => (
                      <span
                        key={stack}
                        className="m-[2px] w-[72px] shrink-0 text-center text-[11px] font-medium text-[#1A2942]/60 sm:w-[90px]"
                      >
                        {String(stack).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                  {floorNumbers.map((floor) => {
                    const floorUnits = data.floors[String(floor)] || {};
                    return (
                      <div key={floor} className="flex items-center gap-1.5">
                        <span className="w-11 shrink-0 pr-1 text-right text-[11px] font-medium text-[#a9894f]">
                          F{String(floor).padStart(2, "0")}
                        </span>
                        {data.stacks.map((stack) => {
                          const unit = floorUnits[String(stack)];
                          if (!unit) {
                            return (
                              <div
                                key={stack}
                                className="m-[2px] h-[68px] w-[72px] shrink-0 sm:h-[82px] sm:w-[90px]"
                              />
                            );
                          }
                          const s = STATUS_STYLES[unit.status] || STATUS_STYLES.no_data;
                          const active = selectedUnit?.unit === unit.unit;
                          const latest = unit.latestTx;
                          const fullAddress = `${data.selectedBlock} ${data.projectName} #${unit.unit}`;
                          return (
                            <button
                              key={stack}
                              type="button"
                              title={`Unit #${unit.unit}`}
                              onClick={() => setSelectedUnit(unit)}
                              style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border, borderWidth: 1 }}
                              className={`relative m-[2px] flex h-[68px] w-[72px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-center leading-tight transition sm:h-[82px] sm:w-[90px] ${
                                active ? "ring-2 ring-[#1A2942] ring-offset-1" : "hover:brightness-95"
                              }`}
                            >
                              {/* Unit number */}
                              <span className="text-[9px] opacity-70 sm:text-[10px]">#{unit.unit}</span>
                              {/* Latest price */}
                              <span className="text-[9px] font-bold sm:text-[11px]">
                                {latest ? formatPrice(latest.price) : "—"}
                              </span>
                              {/* Latest PSF */}
                              {latest && latest.psf > 0 && (
                                <span className="text-[9px] sm:text-[10px]">
                                  ${Math.round(latest.psf).toLocaleString("en-SG")} psf
                                </span>
                              )}
                              {/* Profit / loss */}
                              {unit.transactionCount >= 2 && unit.profitPct != null ? (
                                <span
                                  className="text-[9px] font-semibold sm:text-[10px]"
                                  style={{ color: unit.profitPct >= 0 ? PROFIT_TEXT : LOSS_TEXT }}
                                >
                                  {unit.profitPct >= 0 ? "+" : ""}
                                  {unit.profitPct.toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-[9px] opacity-75 sm:text-[10px]">
                                  {unit.transactionCount === 1 ? "1 tx" : "No data"}
                                </span>
                              )}
                              {/* SSD indicator (inherits cell colour: amber on ssd, red on unprofitable) */}
                              {unit.ssdStatus === "in_period" && (
                                <span className="text-[9px] font-semibold">SSD {(unit.ssdRate * 100).toFixed(0)}%</span>
                              )}
                              {/* HomeValue link */}
                              <a
                                href={`https://homevalue.nexdoor.sg/?address=${encodeURIComponent(fullAddress)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Get estimated value on HomeValue"
                                style={{ position: "absolute", bottom: "2px", right: "3px", fontSize: "8px", opacity: 0.6, textDecoration: "none", color: "inherit" }}
                              >
                                HV↗
                              </a>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Unit detail panel */}
              {selectedUnit && (
                <UnitPanel unit={selectedUnit} onClose={() => setSelectedUnit(null)} />
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function LegendDot({ style, label }: { style: StatusStyle; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={{ backgroundColor: style.bg, border: `1px solid ${style.border}` }}
      />
      {label}
    </span>
  );
}

function UnitPanel({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const txsDesc = [...unit.allTransactions].reverse();
  const latest = unit.latestTx;
  const afterCutoff = latest ? latest.date >= "2025-07-04" : false;
  const ssdYears = afterCutoff ? 4 : 3;
  const yearsHeld = latest ? yearsHeldFrom(latest.date) : 0;

  return (
    <aside className="w-full shrink-0 rounded-2xl border border-[#e7dcc8] bg-white p-5 lg:w-[380px] lg:max-w-[380px]">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#1A2942]">Unit #{unit.unit}</h2>
          {latest && (
            <p className="mt-0.5 text-xs text-[#a9894f]">Last transacted: {fmtDate(latest.date)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e7dcc8] text-[#71695d] transition hover:border-[#a9894f] hover:text-[#1A2942]"
        >
          ×
        </button>
      </div>

      {/* Transaction history */}
      <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a9894f]">
        Transaction History
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-[#a9894f]">
              <th className="py-1 pr-2 font-semibold">Date</th>
              <th className="py-1 pr-2 font-semibold">Price</th>
              <th className="py-1 pr-2 font-semibold">PSF</th>
              <th className="py-1 pr-2 font-semibold">Area</th>
              <th className="py-1 font-semibold">Type</th>
            </tr>
          </thead>
          <tbody>
            {txsDesc.map((tx, i) => (
              <tr key={i} className="border-t border-[#f0e8da] text-[#1A2942]">
                <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(tx.date)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap font-semibold">{fmtMoney(tx.price)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{tx.psf ? `$${Math.round(tx.psf).toLocaleString("en-SG")}` : "—"}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{tx.sqft ? `${tx.sqft.toLocaleString("en-SG")} sqft` : "—"}</td>
                <td className="py-1.5 whitespace-nowrap text-[#71695d]">{tx.type || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Profitability */}
      {unit.profitable != null && unit.profitAmount != null && unit.profitPct != null && (
        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a9894f]">
            Latest vs Previous
          </h3>
          <span
            className={`mt-2 inline-block rounded-lg px-3 py-1.5 text-sm font-bold ${
              unit.profitable ? "bg-[#e2f1e4] text-[#2f6b3a]" : "bg-[#fbe4e0] text-[#a3311c]"
            }`}
          >
            {fmtSigned(unit.profitAmount)} ({fmtPct(unit.profitPct)})
          </span>
        </div>
      )}

      {/* SSD status */}
      <div className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a9894f]">SSD Status</h3>
        {unit.ssdStatus === "cleared" ? (
          <div className="mt-2 rounded-xl border border-[#c3e0c8] bg-[#e2f1e4] px-4 py-3 text-sm font-semibold text-[#2f6b3a]">
            ✅ SSD Cleared — no SSD payable
          </div>
        ) : unit.ssdStatus === "in_period" && latest ? (
          <div className="mt-2 rounded-xl border border-[#eeddb0] bg-[#fbf0d8] px-4 py-3 text-sm text-[#8a6414]">
            <p className="font-semibold">⚠ In SSD Period</p>
            <dl className="mt-2 space-y-1">
              <Row label="Purchased" value={fmtDate(latest.date)} />
              <Row label="SSD clears" value={fmtDate(unit.ssdClearsDate)} />
              <Row label="Years held" value={`${yearsHeld.toFixed(1)} years`} />
              <Row label="Applicable rate" value={`${(unit.ssdRate * 100).toFixed(0)}%`} />
              <Row label="Est. SSD if sold now" value={fmtMoney(unit.ssdAmount)} />
            </dl>
            <p className="mt-2 text-xs text-[#a9894f]">
              SSD is based on the {ssdYears}-year regime (purchased {afterCutoff ? "after" : "before"} 4 Jul 2025).
            </p>
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-dashed border-[#d8c7ad] bg-[#fbf7ef] px-4 py-3 text-sm text-[#71695d]">
            No SSD data available.
          </div>
        )}
      </div>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[#8a6414]/80">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function TowerSkeleton() {
  return (
    <div className="mt-10 flex flex-col items-center justify-center gap-4 rounded-2xl border border-[#e7dcc8] bg-white px-6 py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#e7dcc8] border-t-[#B84C30]" />
      <p className="text-sm font-medium tracking-wide text-[#71695d]">Loading tower data…</p>
    </div>
  );
}

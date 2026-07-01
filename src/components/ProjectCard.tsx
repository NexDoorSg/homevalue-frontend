"use client";

import { useEffect, useState } from "react";
import ProjectPriceChart from "./ProjectPriceChart";
import {
  formatDate,
  formatDistrict,
  formatRentalPsf,
  formatTenure,
  segmentBadgeClasses,
  type Project,
  type ProjectStats,
} from "@/lib/projects";

type ProjectCardProps = {
  project: Project;
  onClose: () => void;
};

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e7dcc8] bg-[#fbf7ef] px-4 py-3 text-center">
      <p className="text-lg font-semibold text-[#1A2942] sm:text-xl">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#a9894f]">{label}</p>
    </div>
  );
}

export default function ProjectCard({ project, onClose }: ProjectCardProps) {
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Close on Escape and lock body scroll while the modal is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);

    fetch(`/api/projects/${encodeURIComponent(project.project_name)}/stats`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load stats");
        return res.json();
      })
      .then((data: ProjectStats) => {
        if (active) {
          setStats(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [project.project_name]);

  const rental = formatRentalPsf(project.avg_rental_psf_pm);
  const profitablePct = stats ? `${stats.profitability.profitable_pct}%` : "—";
  const hasProfitability = stats && stats.profitability.total_with_2_transactions > 0;
  const enrichedDate = formatDate(project.last_enriched_at);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[#0f1626]/60 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${project.project_name} details`}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[800px] rounded-[28px] border border-[#e7dcc8] bg-white shadow-[0_30px_80px_rgba(15,22,38,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-[#e7dcc8] bg-white text-lg text-[#71695d] transition hover:border-[#a9894f] hover:text-[#1A2942]"
        >
          ×
        </button>

        <div className="p-6 sm:p-8">
          {/* Header */}
          <div className="pr-10">
            <h2 className="font-[family-name:var(--font-playfair)] text-2xl font-bold tracking-tight text-[#1A2942] sm:text-3xl">
              {project.project_name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#71695d]">
              {project.street_name && <span>{project.street_name}</span>}
              <span aria-hidden="true">·</span>
              <span>{formatDistrict(project.district)}</span>
              {project.market_segment && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${segmentBadgeClasses(
                    project.market_segment,
                  )}`}
                >
                  {project.market_segment}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#71695d]">
              <span>{formatTenure(project.tenure)}</span>
              {project.property_type && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{project.property_type}</span>
                </>
              )}
              {project.developer && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{project.developer}</span>
                </>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatBox
              label="Total Units"
              value={project.total_units != null ? project.total_units.toLocaleString("en-SG") : "—"}
            />
            <StatBox label="Avg Rental PSF" value={rental ? rental.replace(" psf pm", "") : "—"} />
            <StatBox label="Profitable" value={hasProfitability ? profitablePct : "—"} />
            <StatBox label="District" value={formatDistrict(project.district)} />
          </div>

          {/* Price history chart */}
          <section className="mt-8">
            <h3 className="text-lg font-semibold text-[#1A2942]">Historical Average PSF</h3>
            <div className="mt-4">
              {loading ? (
                <div className="h-[280px] animate-pulse rounded-2xl bg-[#f3ece0]" />
              ) : error ? (
                <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-[#d8c7ad] bg-[#fbf7ef] text-sm text-[#71695d]">
                  Unable to load price history
                </div>
              ) : (
                <ProjectPriceChart data={stats?.priceHistory || []} />
              )}
            </div>
          </section>

          {/* Profitability */}
          <section className="mt-8">
            <h3 className="text-lg font-semibold text-[#1A2942]">Unit Profitability</h3>
            <p className="mt-1 text-sm text-[#71695d]">Based on last 2 transactions per unit</p>

            {loading ? (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="h-24 animate-pulse rounded-2xl bg-[#f3ece0]" />
                <div className="h-24 animate-pulse rounded-2xl bg-[#f3ece0]" />
              </div>
            ) : hasProfitability ? (
              <>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#c3e0c8] bg-[#e2f1e4] px-5 py-4">
                    <p className="text-sm font-semibold text-[#2f6b3a]">✅ Profitable</p>
                    <p className="mt-1 text-2xl font-bold text-[#2f6b3a]">
                      {stats!.profitability.profitable.toLocaleString("en-SG")}
                      <span className="ml-2 text-base font-semibold">({stats!.profitability.profitable_pct}%)</span>
                    </p>
                    <p className="mt-1 text-xs text-[#2f6b3a]/80">units</p>
                  </div>
                  <div className="rounded-2xl border border-[#f0c4bb] bg-[#fbe4e0] px-5 py-4">
                    <p className="text-sm font-semibold text-[#a3311c]">❌ Unprofitable</p>
                    <p className="mt-1 text-2xl font-bold text-[#a3311c]">
                      {stats!.profitability.unprofitable.toLocaleString("en-SG")}
                      <span className="ml-2 text-base font-semibold">({stats!.profitability.unprofitable_pct}%)</span>
                    </p>
                    <p className="mt-1 text-xs text-[#a3311c]/80">units</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-[#a9894f]">Units with only 1 transaction excluded</p>
              </>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-[#d8c7ad] bg-[#fbf7ef] px-5 py-6 text-center text-sm text-[#71695d]">
                Insufficient transaction data
              </div>
            )}
          </section>

          {/* Footer */}
          <p className="mt-8 border-t border-[#f0e8da] pt-4 text-xs text-[#a9894f]">
            Data sourced from URA REALIS.{enrichedDate ? ` Updated ${enrichedDate}.` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

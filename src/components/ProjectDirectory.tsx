"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProjectCard from "./ProjectCard";
import {
  formatDistrict,
  formatRentalPsf,
  formatTenure,
  segmentBadgeClasses,
  type Project,
  type ProjectsResponse,
} from "@/lib/projects";

const PAGE_SIZE = 24;

type Filters = {
  search: string;
  district: string;
  market_segment: string;
  tenure: string;
  property_type: string;
  rental: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  district: "",
  market_segment: "",
  tenure: "",
  property_type: "",
  rental: "",
};

const DISTRICT_OPTIONS = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, "0"));

const PROPERTY_TYPE_OPTIONS = [
  { value: "Condominium", label: "Condominium" },
  { value: "Apartment", label: "Apartment" },
  { value: "Executive Condominium", label: "Executive Condominium" },
];

const TENURE_OPTIONS = [
  { value: "freehold", label: "Freehold" },
  { value: "99", label: "99-year" },
  { value: "999", label: "999-year" },
];

// avg_rental_psf_pm is a $/psf/month figure (data ranges ~$2–$10, median ~$5),
// so the "rental" filter maps to dollar bands rather than yield percentages.
const RENTAL_OPTIONS = [
  { value: "below4", label: "Below $4 psf" },
  { value: "4to6", label: "$4 – $6 psf" },
  { value: "above6", label: "Above $6 psf" },
];

function rentalToParams(rental: string): { min?: string; max?: string } {
  switch (rental) {
    case "below4":
      return { max: "4" };
    case "4to6":
      return { min: "4", max: "6" };
    case "above6":
      return { min: "6" };
    default:
      return {};
  }
}

function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.district) params.set("district", filters.district);
  if (filters.market_segment) params.set("market_segment", filters.market_segment);
  if (filters.tenure) params.set("tenure", filters.tenure);
  if (filters.property_type) params.set("property_type", filters.property_type);
  const rental = rentalToParams(filters.rental);
  if (rental.min) params.set("min_rental", rental.min);
  if (rental.max) params.set("max_rental", rental.max);
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

const SELECT_CLASSES =
  "rounded-full border border-[#d8c7ad] bg-white px-4 py-2.5 text-sm font-medium text-[#1A2942] transition focus:border-[#a9894f] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/30";

function ProjectGridCard({ project, onView }: { project: Project; onView: () => void }) {
  const rental = formatRentalPsf(project.avg_rental_psf_pm);
  return (
    <button
      type="button"
      onClick={onView}
      className="group flex h-full flex-col rounded-[22px] border border-[#e7dcc8] bg-white p-5 text-left shadow-[0_10px_30px_rgba(23,36,58,0.04)] transition hover:-translate-y-1 hover:border-[#d8c7ad] hover:shadow-[0_20px_50px_rgba(23,36,58,0.12)]"
    >
      <h3 className="truncate text-base font-bold text-[#1A2942]" title={project.project_name}>
        {project.project_name}
      </h3>
      {project.street_name && (
        <p className="mt-1 truncate text-xs text-[#8a8175]" title={project.street_name}>
          {project.street_name}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-[#d8c7ad] bg-[#fbf7ef] px-2.5 py-0.5 text-xs font-semibold text-[#1A2942]">
          {formatDistrict(project.district)}
        </span>
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

      <p className="mt-3 text-xs text-[#71695d]">{formatTenure(project.tenure)}</p>
      {project.developer && (
        <p className="mt-1 truncate text-xs text-[#8a8175]" title={project.developer}>
          {project.developer}
        </p>
      )}
      {rental && <p className="mt-2 text-sm font-semibold text-[#1A2942]">{rental}</p>}

      <span className="mt-4 inline-flex w-fit items-center gap-1 rounded-full bg-[#B84C30] px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-[#a03f27]">
        View Project →
      </span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex h-full flex-col rounded-[22px] border border-[#e7dcc8] bg-white p-5">
      <div className="h-4 w-2/3 animate-pulse rounded bg-[#f3ece0]" />
      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[#f3ece0]" />
      <div className="mt-4 flex gap-2">
        <div className="h-5 w-12 animate-pulse rounded-full bg-[#f3ece0]" />
        <div className="h-5 w-12 animate-pulse rounded-full bg-[#f3ece0]" />
      </div>
      <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-[#f3ece0]" />
      <div className="mt-6 h-9 w-32 animate-pulse rounded-full bg-[#f3ece0]" />
    </div>
  );
}

// Windowed page numbers around the current page (e.g. 1 … 4 5 6 … 20).
function pageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

export default function ProjectDirectory() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Debounce the search box (300ms) before it becomes an active filter.
  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((prev) => {
        if (prev.search === searchInput) return prev;
        return { ...prev, search: searchInput };
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Any filter change resets to page 1.
  const setFilter = useCallback((key: keyof Filters, value: string) => {
    setCurrentPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setCurrentPage(1);
    setSearchInput("");
    setFilters(EMPTY_FILTERS);
  }, []);

  // Reset to page 1 whenever the debounced search term changes.
  const searchFilter = filters.search;
  useEffect(() => {
    setCurrentPage(1);
  }, [searchFilter]);

  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setLoading(true);
    setError(false);

    fetch(`/api/projects?${buildQuery(filters, currentPage)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load projects");
        return res.json();
      })
      .then((data: ProjectsResponse) => {
        if (id !== requestId.current) return;
        setProjects(data.projects || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted || id !== requestId.current) return;
        console.error(err);
        setError(true);
        setLoading(false);
      });

    return () => controller.abort();
  }, [filters, currentPage]);

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([key, value]) => key !== "search" && value !== "").length +
      (filters.search ? 1 : 0),
    [filters],
  );

  const pages = useMemo(() => pageWindow(currentPage, totalPages), [currentPage, totalPages]);

  return (
    <main className="min-h-screen bg-[#fbf7ef] px-6 py-12 md:px-10">
      <div className="mx-auto max-w-[1200px]">
        {/* Header */}
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a9894f]">
            HomeValue by NexDoor
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-playfair)] text-3xl font-bold tracking-tight text-[#1A2942] sm:text-4xl">
            Project Directory
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[#71695d] sm:text-base">
            Browse 2,900+ private residential projects in Singapore. Filter by district, segment,
            tenure and more, then open any project for its price history and unit profitability.
          </p>
        </header>

        {/* Filter bar */}
        <div className="mt-8 rounded-[24px] border border-[#e7dcc8] bg-white p-5 shadow-[0_16px_44px_rgba(23,36,58,0.05)] sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by project name…"
                className="w-full rounded-full border border-[#d8c7ad] bg-white px-5 py-2.5 text-sm text-[#1A2942] transition placeholder:text-[#a89f90] focus:border-[#a9894f] focus:outline-none focus:ring-2 focus:ring-[#c9a96e]/30"
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              className="shrink-0 rounded-full border border-[#d8c7ad] bg-[#fbf7ef] px-4 py-2.5 text-sm font-semibold text-[#1A2942] transition hover:border-[#a9894f] md:hidden"
              aria-expanded={filtersOpen}
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </div>

          <div className={`${filtersOpen ? "flex" : "hidden"} mt-4 flex-wrap gap-3 md:flex`}>
            <select
              aria-label="District"
              value={filters.district}
              onChange={(event) => setFilter("district", event.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="">All Districts</option>
              {DISTRICT_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  D{d}
                </option>
              ))}
            </select>

            <select
              aria-label="Market segment"
              value={filters.market_segment}
              onChange={(event) => setFilter("market_segment", event.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="">All Segments</option>
              <option value="CCR">CCR</option>
              <option value="RCR">RCR</option>
              <option value="OCR">OCR</option>
            </select>

            <select
              aria-label="Tenure"
              value={filters.tenure}
              onChange={(event) => setFilter("tenure", event.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="">All Tenures</option>
              {TENURE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Property type"
              value={filters.property_type}
              onChange={(event) => setFilter("property_type", event.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="">All Types</option>
              {PROPERTY_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Average rental"
              value={filters.rental}
              onChange={(event) => setFilter("rental", event.target.value)}
              className={SELECT_CLASSES}
            >
              <option value="">All Rentals</option>
              {RENTAL_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-full border border-[#e0b9ac] bg-[#fbe9e3] px-4 py-2.5 text-sm font-semibold text-[#a3311c] transition hover:border-[#B84C30]"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        {/* Results count */}
        <p className="mt-6 text-sm text-[#71695d]">
          {loading
            ? "Loading projects…"
            : `Showing ${projects.length.toLocaleString("en-SG")} of ${total.toLocaleString("en-SG")} projects`}
        </p>

        {/* Grid */}
        {error ? (
          <div className="mt-4 rounded-[22px] border border-dashed border-[#d8c7ad] bg-white px-6 py-16 text-center text-sm text-[#71695d]">
            Something went wrong loading projects. Please try again.
          </div>
        ) : loading ? (
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mt-4 rounded-[22px] border border-dashed border-[#d8c7ad] bg-white px-6 py-16 text-center text-sm text-[#71695d]">
            No projects match these filters. Try clearing some filters.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectGridCard
                key={project.id}
                project={project}
                onView={() => setSelectedProject(project)}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && totalPages > 1 && (
          <nav className="mt-10 flex flex-wrap items-center justify-center gap-2" aria-label="Pagination">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="rounded-full border border-[#d8c7ad] bg-white px-4 py-2 text-sm font-semibold text-[#1A2942] transition hover:border-[#a9894f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            {pages.map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-2 text-sm text-[#a89f90]">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCurrentPage(p)}
                  aria-current={p === currentPage ? "page" : undefined}
                  className={`min-w-[40px] rounded-full border px-3 py-2 text-sm font-semibold transition ${
                    p === currentPage
                      ? "border-[#1A2942] bg-[#1A2942] text-white"
                      : "border-[#d8c7ad] bg-white text-[#1A2942] hover:border-[#a9894f]"
                  }`}
                >
                  {p}
                </button>
              ),
            )}
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-full border border-[#d8c7ad] bg-white px-4 py-2 text-sm font-semibold text-[#1A2942] transition hover:border-[#a9894f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </nav>
        )}
      </div>

      {selectedProject && (
        <ProjectCard project={selectedProject} onClose={() => setSelectedProject(null)} />
      )}
    </main>
  );
}

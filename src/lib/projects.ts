// Shared types and formatting helpers for the Project Directory feature.

export type Project = {
  id: number;
  project_name: string;
  street_name: string | null;
  district: string | null;
  market_segment: string | null;
  region: string | null;
  developer: string | null;
  tenure: string | null;
  property_type: string | null;
  total_units: number | null;
  units_sold_to_date: number | null;
  avg_rental_psf_pm: number | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  last_enriched_at: string | null;
};

export type PricePoint = {
  quarter: string;
  avg_psf: number;
  transaction_count: number;
};

export type Profitability = {
  profitable: number;
  unprofitable: number;
  total_with_2_transactions: number;
  profitable_pct: number;
  unprofitable_pct: number;
};

export type ProjectStats = {
  project: Project;
  priceHistory: PricePoint[];
  profitability: Profitability;
};

export type ProjectsResponse = {
  projects: Project[];
  total: number;
  page: number;
  totalPages: number;
};

// Market segment badge colours: CCR = red, RCR = amber, OCR = green.
export function segmentBadgeClasses(segment: string | null | undefined): string {
  switch ((segment || "").toUpperCase()) {
    case "CCR":
      return "bg-[#fbe4e0] text-[#a3311c] border border-[#f0c4bb]";
    case "RCR":
      return "bg-[#fbf0d8] text-[#8a6414] border border-[#eeddb0]";
    case "OCR":
      return "bg-[#e2f1e4] text-[#2f6b3a] border border-[#c3e0c8]";
    default:
      return "bg-[#ede4d8] text-[#71695d] border border-[#d8c7ad]";
  }
}

// projects_master stores districts as "07"; display as "D07".
export function formatDistrict(district: string | null | undefined): string {
  const value = (district || "").trim();
  if (!value) return "—";
  return `D${value.padStart(2, "0")}`;
}

// Condense a verbose tenure string into a short label.
// e.g. "99 yrs lease commencing from 2024" -> "99-year", "Freehold" -> "Freehold".
export function formatTenure(tenure: string | null | undefined): string {
  const value = (tenure || "").trim();
  if (!value) return "—";
  if (/freehold/i.test(value)) return "Freehold";
  const match = value.match(/^(\d+)\s*yr/i);
  if (match) return `${match[1]}-year`;
  return value;
}

export function formatRentalPsf(value: number | string | null | undefined): string | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `$${num.toFixed(2)} psf pm`;
}

// "2026-07-01T03:35:58.786741+00:00" -> "1 Jul 2026"
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

#!/usr/bin/env python3
"""
Monthly recompute of the condo/EC floor-elasticity height-tier fallback betas.

Background
----------
src/lib/valuation.ts (Stage 3b) scales a condo/EC valuation from the comps'
reference floor to the subject's floor along  psm ∝ floor^β.  β is fit live
per project when the project has enough floor spread; projects that are too
thin fall back to a static height-tier β table:

    CONDO_EC_FLOOR_TIER_BETA = { low: 0.015, mid: 0.031, high: 0.040, vhigh: 0.053 }

Those four numbers were fit once (2026-07) from a size-controlled,
within-project-demeaned OLS regression pooled by height tier. Floor premia
drift with the market, so this job recomputes them monthly and writes the
result to src/lib/condoEcFloorTierBeta.json, which valuation.ts reads (falling
back to the baked-in static values for any tier the JSON doesn't override).

Methodology (replicates the Stage 3b backtest "SEGMENT beta" section exactly)
----------------------------------------------------------------------------
  * Population: condo + EC transactions in the last 5 years, matching the
    unit_type / property_subtype filters the engine itself uses.
  * Floor level is parsed from the ADDRESS with the SAME regex the engine uses
    (#NN-… on the upper-cased address) so the fit sees the floors production
    sees — not a `floor_level` column the engine ignores for condo/EC.
  * Per project: keep rows with floor>0, area>0, psm>0. Assign the project a
    height tier from its MAX observed floor. A project contributes to its tier's
    pool only if it has >=6 such rows AND >=3 distinct floors (needs real
    within-project floor spread to say anything about floor premium).
  * Within each contributing project, mean-centre ln(floor), ln(area), ln(psm).
  * Pool the demeaned rows by tier and run a no-intercept 2-var OLS
    ln(psm) = β·ln(floor) + γ·ln(area). β is the tier's floor elasticity.

Low-risk update policy
----------------------
For each tier, the newly fit β replaces the prior value ONLY IF it is
plausible and well-sampled; otherwise the PRIOR value is kept and a warning is
logged (and recorded in the JSON meta). "Implausible" = not finite, negative,
or > 0.10 — matching the guard valuation.ts applies on read. A tier with too
few pooled rows / contributing projects is also left untouched, so a degenerate
data month can never churn a good value.

Reads Supabase over the REST API with the public anon key (same as the HDB
sync's read path) — no secret required. Writes only a local JSON file; the
GitHub Action opens a PR with the diff.

Usage:
  python3 scripts/floor_beta_recompute/recompute_floor_betas.py            # write JSON
  python3 scripts/floor_beta_recompute/recompute_floor_betas.py --dry-run  # print only
"""

import os
import re
import json
import math
import time
import argparse
import urllib.request
import urllib.error
import urllib.parse
from datetime import date, timedelta

# ---- Supabase (read-only; anon key, same as the HDB sync read path) ----
SUPABASE_URL = "https://uooqynhqjeusryuwghhe.supabase.co"
ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvb3F5"
    "bmhxamV1c3J5dXdnaGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3MDUwMTMsImV4cCI6MjA5MTI4MTAxM30."
    "t4kKDQGY-YNSPJxYLu1fgeGFSrIiEc2nHlgksiCTbSE"
)
TABLE = "property_transactions_v2"
PAGE = 1000

# ---- HTTP retry/backoff (mirrors sync_hdb_datagov.get_json) ----
HTTP_MAX_RETRIES = 4
HTTP_BACKOFF_S = 0.4

# ---- Regression window / gates (mirror the Stage 3b backtest segment section) ----
FIVE_YEARS_DAYS = 365 * 5
PROJECT_MIN_ROWS = 6        # a project must have >=6 usable rows to contribute…
PROJECT_MIN_DISTINCT = 3    # …and >=3 distinct floors (real within-project spread)

# ---- Update-policy guards ----
# Plausible elasticity band. Mirrors the guard valuation.ts applies on read:
# a floor premium is never negative and never above ~10% per log-floor.
BETA_MIN, BETA_MAX = 0.0, 0.10
# Don't trust — and don't overwrite a good prior with — a tier fit from a thin
# month. These are deliberately conservative: the seed fit had thousands of rows
# and dozens of projects per tier, so a real month clears these easily; a month
# that doesn't is anomalous and should keep the prior.
TIER_MIN_ROWS = 200
TIER_MIN_PROJECTS = 8

# ---- Output ----
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUT_JSON = os.path.join(REPO_ROOT, "src", "lib", "condoEcFloorTierBeta.json")
# The baked-in static values that valuation.ts ships with. Used as the prior of
# last resort when the JSON is missing/unreadable, so this script can bootstrap
# the file and always has a well-defined "keep prior" target. Kept in sync with
# CONDO_EC_FLOOR_TIER_BETA_STATIC in src/lib/valuation.ts.
STATIC_PRIOR = {"low": 0.015, "mid": 0.031, "high": 0.040, "vhigh": 0.053}
TIERS = ("low", "mid", "high", "vhigh")

# Condo/EC selection, matching the engine's own filters in
# src/lib/valuation.ts (fetchComparables). Each entry -> a REST query.
SEGMENTS = [
    {
        "label": "condo",
        "unit_type": ["Condominium", "Apartment"],
        "property_subtype": ["condo", "Resale", "New Sale", "Sub Sale"],
    },
    {
        "label": "ec",
        "unit_type": ["Executive Condominium"],
        "property_subtype": ["ec", "Resale", "New Sale", "Sub Sale"],
    },
]

# Floor level from the address — the SAME rule as
# parseFloorLevelFromAddress in src/lib/valuation.ts:
#   normalizeText = (value || '').toUpperCase().trim()
#   match = text.match(/#(\d{1,2})-\d+/)
# i.e. the 1–2 digit storey in a "#12-05" unit token. No HTML-entity decode —
# the engine doesn't decode either, so we match its behaviour exactly.
FLOOR_RE = re.compile(r"#(\d{1,2})-\d+")


def parse_floor_from_address(address):
    text = (address or "").upper().strip()
    m = FLOOR_RE.search(text)
    if not m:
        return None
    try:
        level = int(m.group(1))
    except ValueError:
        return None
    return level if level > 0 else None


def get_json(url, headers=None):
    """GET + parse JSON, retrying on 429/5xx with exponential backoff.

    Re-raises once retries are spent: a soft failure here would fit betas from a
    truncated pull and silently drift the table, which is exactly what the
    keep-prior policy exists to avoid — so fail loudly instead.
    """
    for attempt in range(HTTP_MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r), dict(r.headers)
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt)); continue
            raise
        except Exception:
            if attempt < HTTP_MAX_RETRIES:
                time.sleep(HTTP_BACKOFF_S * (2 ** attempt)); continue
            raise


def in_list(values):
    """PostgREST in.(...) list with each value quoted."""
    return "in.(" + ",".join('"' + v.replace('"', "") + '"' for v in values) + ")"


def fetch_segment(seg, since_iso):
    """Paginate all rows of one condo/EC segment from the last 5 years."""
    base = f"{SUPABASE_URL}/rest/v1/{TABLE}"
    rows, frm = [], 0
    while True:
        qs = urllib.parse.urlencode(
            {
                "select": "project_name,address,transaction_price,floor_area_sqm,transaction_date",
                "unit_type": in_list(seg["unit_type"]),
                "property_subtype": in_list(seg["property_subtype"]),
                "transaction_date": f"gte.{since_iso}",
            }
        )
        data, _ = get_json(
            f"{base}?{qs}", {"apikey": ANON_KEY, "Range": f"{frm}-{frm + PAGE - 1}"}
        )
        if not isinstance(data, list) or not data:
            break
        rows.extend(data)
        if len(data) < PAGE:
            break
        frm += PAGE
    return rows


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def usable_rows(raw):
    """raw REST rows -> [(project, floor, area, psm)] with floor>0, area>0, psm>0."""
    out = []
    for r in raw:
        proj = (r.get("project_name") or "").strip().upper()
        if not proj:
            continue
        floor = parse_floor_from_address(r.get("address"))
        area = to_float(r.get("floor_area_sqm"))
        price = to_float(r.get("transaction_price"))
        if not floor or not area or area <= 0 or not price or price <= 0:
            continue
        psm = price / area
        if psm <= 0:
            continue
        out.append((proj, floor, area, psm))
    return out


def tier_of(max_floor):
    """Height tier from a project's max observed floor (matches condoEcHeightTierBeta)."""
    if max_floor <= 12:
        return "low"
    if max_floor <= 24:
        return "mid"
    if max_floor <= 40:
        return "high"
    return "vhigh"


def ols2(rows):
    """No-intercept 2-var OLS on pre-centred rows: y = b1*x1 + b2*x2.

    rows: iterable of (x1, x2, y). Returns (b1, b2) or None if singular.
    b1 = floor elasticity, b2 = size elasticity. Identical normal-equation
    solve to ols2() in the Stage 3b backtest and getCondoEcProjectFloorBeta()
    in valuation.ts.
    """
    s11 = s22 = s12 = s1y = s2y = 0.0
    for x1, x2, y in rows:
        s11 += x1 * x1
        s22 += x2 * x2
        s12 += x1 * x2
        s1y += x1 * y
        s2y += x2 * y
    det = s11 * s22 - s12 * s12
    if abs(det) < 1e-9:
        return None
    b1 = (s22 * s1y - s12 * s2y) / det
    b2 = (s11 * s2y - s12 * s1y) / det
    return b1, b2


def fit_tier_betas(usable):
    """Replicate the backtest's SEGMENT-beta pooled, within-project-demeaned OLS.

    Returns {tier: {"beta": float|None, "rows": int, "projects": int}}.
    """
    by_project = {}
    for proj, floor, area, psm in usable:
        by_project.setdefault(proj, []).append((floor, area, psm))

    tier_rows = {t: [] for t in TIERS}
    tier_projects = {t: 0 for t in TIERS}
    for proj, rows in by_project.items():
        max_floor = max(r[0] for r in rows)
        t = tier_of(max_floor)
        distinct = len({r[0] for r in rows})
        if len(rows) < PROJECT_MIN_ROWS or distinct < PROJECT_MIN_DISTINCT:
            continue
        lf = [math.log(r[0]) for r in rows]
        la = [math.log(r[1]) for r in rows]
        lp = [math.log(r[2]) for r in rows]
        mf = sum(lf) / len(lf)
        ma = sum(la) / len(la)
        mp = sum(lp) / len(lp)
        tier_rows[t].extend(
            (lf[i] - mf, la[i] - ma, lp[i] - mp) for i in range(len(rows))
        )
        tier_projects[t] += 1

    result = {}
    for t in TIERS:
        rr = tier_rows[t]
        fit = ols2(rr) if rr else None
        result[t] = {
            "beta": (fit[0] if fit else None),
            "rows": len(rr),
            "projects": tier_projects[t],
        }
    return result


def load_prior():
    """Prior betas: from the existing JSON if readable, else the static defaults."""
    try:
        with open(OUT_JSON) as f:
            data = json.load(f)
        betas = data.get("betas", {})
        return {t: float(betas.get(t, STATIC_PRIOR[t])) for t in TIERS}
    except (OSError, ValueError, TypeError):
        return dict(STATIC_PRIOR)


def decide(prior, fit):
    """Apply the keep-prior update policy. Returns (final_betas, warnings)."""
    final, warnings = {}, []
    for t in TIERS:
        info = fit[t]
        beta = info["beta"]
        n, p = info["rows"], info["projects"]
        if beta is None or not math.isfinite(beta):
            warnings.append(f"{t}: fit failed (rows={n}, projects={p}); kept prior {prior[t]:.4f}")
            final[t] = prior[t]
        elif beta < BETA_MIN or beta > BETA_MAX:
            warnings.append(
                f"{t}: implausible beta {beta:+.4f} (outside [{BETA_MIN},{BETA_MAX}]); kept prior {prior[t]:.4f}"
            )
            final[t] = prior[t]
        elif n < TIER_MIN_ROWS or p < TIER_MIN_PROJECTS:
            warnings.append(
                f"{t}: thin sample (rows={n} < {TIER_MIN_ROWS} or projects={p} < {TIER_MIN_PROJECTS}); kept prior {prior[t]:.4f}"
            )
            final[t] = prior[t]
        else:
            final[t] = round(beta, 4)
    return final, warnings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Print the result; do not write the JSON.")
    args = ap.parse_args()

    since_iso = (date.today() - timedelta(days=FIVE_YEARS_DAYS)).isoformat()
    print(f"Recomputing condo/EC floor tier betas — transactions since {since_iso}\n")

    raw = []
    for seg in SEGMENTS:
        seg_raw = fetch_segment(seg, since_iso)
        print(f"  {seg['label']:5}: {len(seg_raw)} rows")
        raw.extend(seg_raw)
    usable = usable_rows(raw)
    print(f"  usable (floor/area/psm valid): {len(usable)} of {len(raw)}\n")

    fit = fit_tier_betas(usable)
    prior = load_prior()
    final, warnings = decide(prior, fit)

    print("=== tier fit (within-project-demeaned pooled OLS) ===")
    for t in TIERS:
        info = fit[t]
        b = info["beta"]
        bstr = f"{b:+.4f}" if b is not None else "  n/a "
        lift = f"{((30 / 5) ** b - 1) * 100:+5.1f}%" if b is not None else "  n/a"
        changed = "→ UPDATE" if final[t] != prior[t] else "  keep  "
        print(
            f"  {t:5}  rows={info['rows']:6d}  projects={info['projects']:4d}  "
            f"beta={bstr}  floor5→30={lift}   prior={prior[t]:.4f}  final={final[t]:.4f}  {changed}"
        )
    if warnings:
        print("\n=== warnings (prior kept) ===")
        for w in warnings:
            print(f"  ! {w}")

    payload = {
        "betas": {t: final[t] for t in TIERS},
        "meta": {
            "updated": date.today().strftime("%Y-%m-%d"),
            "source": "scheduled recompute (scripts/floor_beta_recompute/recompute_floor_betas.py)",
            "method": (
                "within-project-demeaned pooled OLS  ln(psm) ~ b*ln(floor) + g*ln(area)  "
                "over condo/EC transactions in the last 5y, pooled by project-max-floor "
                "height tier (low<=12 / mid 13-24 / high 25-40 / vhigh>40)"
            ),
            "samples": {t: fit[t]["rows"] for t in TIERS},
            "projects": {t: fit[t]["projects"] for t in TIERS},
            "warnings": warnings,
        },
    }

    if args.dry_run:
        print("\n[dry-run] would write:\n" + json.dumps(payload, indent=2))
        return
    with open(OUT_JSON, "w") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    print(f"\nWrote {OUT_JSON}")


if __name__ == "__main__":
    main()

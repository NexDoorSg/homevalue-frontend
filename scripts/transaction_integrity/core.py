"""Pure canonicalisation and safety helpers for transaction integrity tooling."""

from __future__ import annotations

import datetime as dt
import html
import math
import re
import unicodedata
from decimal import Decimal, InvalidOperation


PROPERTY_TYPES = (
    "Condominium",
    "Apartment",
    "Executive Condominium",
    "Terrace House",
    "Semi-Detached House",
    "Detached House",
)
TRANSACTION_ACTIVITIES = ("Resale", "New Sale", "Sub Sale")

_PROPERTY_TYPE_MAP = {
    "condominium": "Condominium",
    "condo": "Condominium",
    "apartment": "Apartment",
    "executive condominium": "Executive Condominium",
    "ec": "Executive Condominium",
    "terrace": "Terrace House",
    "terrace house": "Terrace House",
    "strata terrace": "Terrace House",
    "semi detached": "Semi-Detached House",
    "semi detached house": "Semi-Detached House",
    "strata semi detached": "Semi-Detached House",
    "detached": "Detached House",
    "detached house": "Detached House",
    "strata detached": "Detached House",
}
_ACTIVITY_MAP = {
    "resale": "Resale",
    "new sale": "New Sale",
    "sub sale": "Sub Sale",
}
# Only explicit property groups are safe evidence.  Generic values such as
# "private" and "landed" are intentionally absent.
_GROUP_PROPERTY_TYPE_MAP = {
    "condo": "Condominium",
    "condominium": "Condominium",
    "apartment": "Apartment",
    "ec": "Executive Condominium",
    "executive condominium": "Executive Condominium",
    "terrace": "Terrace House",
    "terrace house": "Terrace House",
    "semi detached": "Semi-Detached House",
    "semi detached house": "Semi-Detached House",
    "detached": "Detached House",
    "detached house": "Detached House",
}

_UNIT_SUFFIX_RE = re.compile(
    r"\s*#\s*([A-Z0-9]+)\s*[-/]\s*([A-Z0-9]+)\s*$", re.IGNORECASE
)
_NON_ALNUM_RE = re.compile(r"[^A-Z0-9]+")
_SPACE_RE = re.compile(r"\s+")
_STREET_TOKENS = {
    "ROAD": "RD",
    "STREET": "ST",
    "AVENUE": "AVE",
    "LANE": "LN",
    "CENTRAL": "CTRL",
    "SOUTH": "STH",
    "NORTH": "NTH",
    "BUKIT": "BT",
    "JALAN": "JLN",
    "LORONG": "LOR",
    "UPPER": "UPP",
}
_ONEMAP_EXPANSIONS = {
    "RD": "ROAD",
    "ST": "STREET",
    "AVE": "AVENUE",
    "LN": "LANE",
    "CTRL": "CENTRAL",
    "STH": "SOUTH",
    "NTH": "NORTH",
    "BT": "BUKIT",
    "JLN": "JALAN",
    "LOR": "LORONG",
    "UPP": "UPPER",
    "DR": "DRIVE",
    "CRES": "CRESCENT",
}


def normalize_text(value) -> str:
    value = html.unescape(str(value or ""))
    value = unicodedata.normalize("NFKC", value).upper().replace("&", " AND ")
    return _SPACE_RE.sub(" ", value).strip()


def normalize_name(value) -> str:
    return _NON_ALNUM_RE.sub(" ", normalize_text(value)).strip()


def _split_unit(value):
    normalized = normalize_text(value)
    match = _UNIT_SUFFIX_RE.search(normalized)
    if not match:
        return normalized, None
    return normalized[: match.start()].strip(), f"#{match.group(1)}-{match.group(2)}"


def strip_unit(value) -> str:
    """Remove an explicit private unit for block/geographic matching only."""
    return _split_unit(value)[0]


def normalize_address(value) -> str:
    tokens = _NON_ALNUM_RE.sub(" ", normalize_text(strip_unit(value))).split()
    return " ".join(_STREET_TOKENS.get(token, token) for token in tokens)


def normalize_transaction_address(value) -> str:
    """Normalize a private transaction address while preserving unit identity."""
    block_address, unit = _split_unit(value)
    normalized_block = normalize_address(block_address)
    return f"{normalized_block} {unit}".strip() if unit else normalized_block


def onemap_query_variants(value):
    """Return exact-address spelling variants, never semantic guesses."""
    raw = normalize_text(strip_unit(value))
    expanded = " ".join(_ONEMAP_EXPANSIONS.get(token, token) for token in raw.split())
    variants = []
    for candidate in (raw, expanded):
        if candidate and candidate not in variants:
            variants.append(candidate)
    return variants


def canonical_property_type(value):
    return _PROPERTY_TYPE_MAP.get(normalize_name(value).lower())


def canonical_activity(value):
    return _ACTIVITY_MAP.get(normalize_name(value).lower())


def property_type_from_group(value):
    return _GROUP_PROPERTY_TYPE_MAP.get(normalize_name(value).lower())


def collapse_project_types(rows):
    """Return only exact project names that map to one unambiguous type."""
    candidates = {}
    for row in rows:
        name = normalize_name(row.get("project_name"))
        ptype = canonical_property_type(row.get("property_type"))
        if name and ptype:
            candidates.setdefault(name, set()).add(ptype)
    return {
        name: next(iter(types))
        for name, types in candidates.items()
        if len(types) == 1
    }


def resolve_classification(row, project_types):
    """Resolve (property type, activity) from explicit evidence only.

    A valid existing unit_type wins.  For malformed REALIS rows the activity is
    commonly in unit_type, so the next evidence is property_subtype, an explicit
    property_group, then an unambiguous exact projects_master classification.
    Generic strata/non-strata flags are never consulted.
    """
    activity = canonical_activity(row.get("property_subtype"))
    if activity is None:
        activity = canonical_activity(row.get("unit_type"))
    if activity is None:
        return None, None, "transaction activity unresolved", None

    evidence = (
        (canonical_property_type(row.get("unit_type")), "unit_type"),
        (canonical_property_type(row.get("property_subtype")), "property_subtype"),
        (property_type_from_group(row.get("property_group")), "property_group"),
        (project_types.get(normalize_name(row.get("project_name"))), "projects_master"),
    )
    for ptype, source in evidence:
        if ptype:
            return ptype, activity, None, source
    return None, activity, "property type unresolved", None


def decimal_token(value):
    if value is None or value == "":
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    rendered = format(number.normalize(), "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return rendered or "0"


def canonical_date(value):
    raw = str(value or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}", raw):
        raw += "-01"
    try:
        return dt.date.fromisoformat(raw).isoformat()
    except (TypeError, ValueError):
        return None


def coordinate_pair(row):
    try:
        lat = float(row.get("latitude"))
        lon = float(row.get("longitude"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


def select_unambiguous_coordinate(candidates):
    """Choose a coordinate only when all valid exact candidates agree."""
    valid = []
    for candidate in candidates:
        pair = coordinate_pair(candidate)
        if pair:
            valid.append((round(pair[0], 5), round(pair[1], 5), candidate))
    distinct = {(lat, lon) for lat, lon, _ in valid}
    if len(distinct) != 1:
        return None
    lat, lon = next(iter(distinct))
    postals = {
        str(item.get("postal_code") or "").strip()
        for _, _, item in valid
        if str(item.get("postal_code") or "").strip().isdigit()
    }
    return {
        "latitude": lat,
        "longitude": lon,
        "postal_code": next(iter(postals)) if len(postals) == 1 else None,
    }


def onemap_result_coordinate(query, results):
    """Accept OneMap only for an exact normalized block/street match.

    OneMap may return a plausible first search hit for an imprecise query.  This
    helper considers every returned result and rejects both non-matches and
    multiple distinct coordinate pairs.
    """
    wanted = normalize_address(query)
    matches = []
    for result in results or []:
        forms = {
            normalize_address(
                f"{result.get('BLK_NO') or ''} {result.get('ROAD_NAME') or ''}"
            ),
            normalize_address(result.get("SEARCHVAL")),
        }
        if wanted and wanted in forms:
            matches.append(
                {
                    "latitude": result.get("LATITUDE"),
                    "longitude": result.get("LONGITUDE"),
                    "postal_code": result.get("POSTAL"),
                }
            )
    return select_unambiguous_coordinate(matches)


def private_structural_key(row, project_types=None):
    """Cross-source key with exact date semantics; never fuzzy-matches dates."""
    project_types = project_types or {}
    ptype = canonical_property_type(row.get("unit_type"))
    if ptype is None:
        ptype = canonical_property_type(row.get("property_subtype"))
    if ptype is None:
        ptype = property_type_from_group(row.get("property_group"))
    if ptype is None:
        ptype = project_types.get(normalize_name(row.get("project_name")))
    return (
        normalize_name(row.get("project_name")),
        normalize_transaction_address(row.get("address")),
        canonical_date(row.get("transaction_date")),
        decimal_token(row.get("transaction_price")),
        decimal_token(row.get("floor_area_sqm")),
        ptype,
    )


def haversine_m(lat1, lon1, lat2, lon2):
    radius_m = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * radius_m * math.atan2(math.sqrt(a), math.sqrt(1 - a))

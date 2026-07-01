import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// CORS so the directory can be consumed from other NexDoor surfaces too.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: CORS_HEADERS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS })
}

// Columns exposed for each project row (mirrors projects_master).
const PROJECT_COLUMNS =
  'id, project_name, street_name, district, market_segment, region, developer, tenure, property_type, total_units, units_sold_to_date, avg_rental_psf_pm, latitude, longitude, completion_year, land_area_sqft, facilities, num_facilities, last_enriched_at'

const DEFAULT_LIMIT = 24
const MAX_SEARCH_ROWS = 1000

// Accepts "05", "5", "D05", "d5" -> "05" (projects_master stores 2-digit strings).
function normaliseDistrict(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return null
  return digits.padStart(2, '0')
}

type ProjectRow = {
  project_name: string | null
  [key: string]: unknown
}

type Filters = {
  search: string
  district: string | null
  marketSegment: string
  tenure: string
  propertyType: string
  minRental: number | null
  maxRental: number | null
}

// A PostgrestFilterBuilder from .select(); typed loosely because filter chains
// return the same builder shape and we reassign as we go (see project-matcher).
type Query = ReturnType<ReturnType<typeof supabase.from>['select']>

function applyFilters(query: Query, f: Filters): Query {
  let q = query
  if (f.search) q = q.ilike('project_name', `%${f.search}%`)
  if (f.district) q = q.eq('district', f.district)
  if (f.marketSegment) q = q.eq('market_segment', f.marketSegment)
  if (f.propertyType) q = q.eq('property_type', f.propertyType)

  if (f.tenure === 'freehold') q = q.ilike('tenure', '%freehold%')
  else if (f.tenure === '99') q = q.ilike('tenure', '99 yrs%')
  else if (f.tenure === '999') q = q.ilike('tenure', '999 yrs%')

  if (f.minRental !== null) q = q.gte('avg_rental_psf_pm', f.minRental)
  if (f.maxRental !== null) q = q.lte('avg_rental_psf_pm', f.maxRental)

  return q
}

// Relevance ordering for a text search: exact match, then starts-with, then
// contains, then alphabetical as the tie-breaker.
function relevanceRank(name: string, term: string): number {
  const n = name.toLowerCase()
  const t = term.toLowerCase()
  if (n === t) return 0
  if (n.startsWith(t)) return 1
  if (n.includes(t)) return 2
  return 3
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams

    const minRentalParam = params.get('min_rental')
    const maxRentalParam = params.get('max_rental')
    const minRental = minRentalParam !== null && Number.isFinite(Number(minRentalParam)) ? Number(minRentalParam) : null
    const maxRental = maxRentalParam !== null && Number.isFinite(Number(maxRentalParam)) ? Number(maxRentalParam) : null

    const filters: Filters = {
      search: (params.get('search') || '').trim(),
      district: normaliseDistrict(params.get('district')),
      marketSegment: (params.get('market_segment') || '').trim().toUpperCase(),
      tenure: (params.get('tenure') || '').trim().toLowerCase(),
      propertyType: (params.get('property_type') || '').trim(),
      minRental,
      maxRental,
    }

    const pageParam = Number(params.get('page'))
    const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1
    const limitParam = Number(params.get('limit'))
    const limit =
      Number.isFinite(limitParam) && limitParam >= 1 && limitParam <= 100
        ? Math.floor(limitParam)
        : DEFAULT_LIMIT

    // With a search term we need relevance ordering, which PostgREST can't do
    // directly. The master table is small (~3k rows) and text filters cut it
    // down hard, so fetch the matches and rank/paginate in memory.
    if (filters.search) {
      const query = applyFilters(supabase.from('projects_master').select(PROJECT_COLUMNS), filters)
      const { data, error } = await query.limit(MAX_SEARCH_ROWS)
      if (error) {
        console.error('projects list (search) query error:', error)
        return json({ error: 'Unable to load projects.' }, { status: 500 })
      }

      const rows = (data || []) as ProjectRow[]
      rows.sort((a, b) => {
        const ra = relevanceRank(a.project_name || '', filters.search)
        const rb = relevanceRank(b.project_name || '', filters.search)
        if (ra !== rb) return ra - rb
        return (a.project_name || '').localeCompare(b.project_name || '')
      })

      const total = rows.length
      const totalPages = Math.max(1, Math.ceil(total / limit))
      const start = (page - 1) * limit
      const projects = rows.slice(start, start + limit)

      return json({ projects, total, page, totalPages })
    }

    // No search: order by name in the DB and page with range + exact count.
    const query = applyFilters(
      supabase.from('projects_master').select(PROJECT_COLUMNS, { count: 'exact' }),
      filters,
    )
      .order('project_name', { ascending: true })
      .range((page - 1) * limit, page * limit - 1)

    const { data, error, count } = await query
    if (error) {
      console.error('projects list query error:', error)
      return json({ error: 'Unable to load projects.' }, { status: 500 })
    }

    const total = count ?? 0
    const totalPages = Math.max(1, Math.ceil(total / limit))

    return json({ projects: data || [], total, page, totalPages })
  } catch (error) {
    console.error('projects list error:', error)
    return json({ error: 'Unable to load projects.' }, { status: 500 })
  }
}

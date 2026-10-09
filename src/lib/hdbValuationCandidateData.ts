import { supabase } from './supabase'
import { subjectHdbStreetKey } from './hdbStreetAbbrev'
import { buildHdbCandidateV2, hdbAsOf, type HdbCandidateParams, type HdbTransaction } from './hdbValuationCandidate'

const COLUMNS = 'id,address,unit_type,transaction_price,floor_area_sqm,transaction_date,latitude,longitude,completion_year,floor_level'

export async function getHdbCandidateValuation(params: HdbCandidateParams) {
  const asOf = hdbAsOf(params.valuationDate)
  if (![params.lat, params.lon, params.floorAreaSqm].every(Number.isFinite) || params.floorAreaSqm <= 0 ||
    Math.abs(params.lat) > 90 || Math.abs(params.lon) > 180 || !params.propertyType.trim()) return null
  const asOfIso = asOf.toISOString().slice(0, 10)
  const from = new Date(asOf)
  from.setUTCFullYear(from.getUTCFullYear() - 1)
  from.setUTCDate(from.getUTCDate() - 1) // Include leap/month boundary; pure engine applies exact window.
  const latDelta = 2000 / 111000
  const lonDelta = 2000 / (111000 * Math.max(Math.abs(Math.cos(params.lat * Math.PI / 180)), 0.2))
  const unitType = params.propertyType.toUpperCase().trim()
  const rows: HdbTransaction[] = []
  // Fetch the recent neighbourhood once, then select true circular radii in the
  // pure model. Stable pagination avoids the legacy top-1000 radius truncation.
  for (let offset = 0; ; offset += 500) {
    if (offset >= 10000) throw new Error('Candidate transaction pool exceeds the preview limit; no estimate was produced.')
    const { data, error } = await supabase.from('property_transactions_v2')
      .select(COLUMNS).eq('property_group', 'hdb').eq('unit_type', unitType)
      .gte('latitude', params.lat - latDelta).lte('latitude', params.lat + latDelta)
      .gte('longitude', params.lon - lonDelta).lte('longitude', params.lon + lonDelta)
      .gte('transaction_date', from.toISOString().slice(0, 10)).lte('transaction_date', asOfIso)
      .order('transaction_date', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + 499)
    if (error) throw new Error(`Candidate neighbourhood query failed: ${error.message}`)
    rows.push(...(data || []) as HdbTransaction[])
    if (!data || data.length < 500) break
  }
  const block = (params.subjectBlockNo || params.subjectAddress?.match(/^(\d+[A-Z]?)\s/i)?.[1] || '').toUpperCase().trim()
  const street = subjectHdbStreetKey(params.subjectStreetName, params.subjectAddress)
  if (block && street) {
    // Block history is fetched separately; none of the >24-month rows receive price weight.
    for (let offset = 0; ; offset += 500) {
      if (offset >= 10000) throw new Error('Candidate block history exceeds the preview limit; no estimate was produced.')
      const { data, error } = await supabase.from('property_transactions_v2')
        .select(COLUMNS).eq('property_group', 'hdb').eq('unit_type', unitType)
        .eq('address', `${block} ${street}`).lte('transaction_date', asOfIso)
        .order('transaction_date', { ascending: false }).order('id', { ascending: true })
        .range(offset, offset + 499)
      if (error) throw new Error(`Candidate block query failed: ${error.message}`)
      rows.push(...(data || []) as HdbTransaction[])
      if (!data || data.length < 500) break
    }
  }
  // The ingestion script writes lease_commence_date into transaction completion_year.
  // Compare actual completion years for BOTH subject and comps; never mix the two.
  const rowBlock = (address: string | null) => address?.toUpperCase().trim().match(/^(\d+[A-Z]?)\s/)?.[1] || ''
  const blocks = Array.from(new Set([block, ...rows.map(r => rowBlock(r.address))])).filter(Boolean)
  const streets = Array.from(new Set([street, ...rows.map(r => subjectHdbStreetKey(null, r.address))])).filter(Boolean)
  const years = new Map<string, number>()
  if (blocks.length && streets.length) {
    for (let offset = 0; ; offset += 500) {
      if (offset >= 20000) throw new Error('Block reference lookup exceeds the preview limit.')
      const { data, error } = await supabase.from('hdb_block_info').select('blk_no,street,year_completed')
        .in('blk_no', blocks).in('street', streets).order('blk_no').order('street').range(offset, offset + 499)
      if (error) throw new Error(`Block completion-year lookup failed: ${error.message}`)
      for (const info of data || []) {
        const year = Number(info.year_completed)
        if (Number.isFinite(year) && year > 1950) years.set(`${info.blk_no}|${info.street}`, year)
      }
      if (!data || data.length < 500) break
    }
  }
  const completionYear = years.get(`${block}|${street}`) ?? params.subjectCompletionYearHdb ?? params.subjectCompletionYear ?? null
  const consistentRows = rows.map(r => ({ ...r, completion_year: years.get(`${rowBlock(r.address)}|${subjectHdbStreetKey(null, r.address)}`) ?? null }))
  return buildHdbCandidateV2(consistentRows, { ...params, subjectCompletionYearHdb: completionYear })
}

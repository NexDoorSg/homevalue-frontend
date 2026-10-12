/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS offline harness. */
// Usage: node scripts/hdb_valuation/backtest.cjs SNAPSHOT_DIRECTORY OUTPUT_DIRECTORY
// Only immutable public transaction snapshots are read. No network/cache writes.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { loadTs, snapshotSupabase } = require('./load-ts.cjs')
const root = path.resolve(__dirname, '../..')
const dataDir = path.resolve(process.argv[2] || '../data')
const outDir = path.resolve(process.argv[3] || 'work/hdb-backtest')
fs.mkdirSync(outDir, { recursive: true })
const candidate = loadTs(path.join(root, 'src/lib/hdbValuationCandidate.ts'))
const { subjectHdbStreetKey } = loadTs(path.join(root, 'src/lib/hdbStreetAbbrev.ts'))
const { buildHdbCandidateV2: build, hdbStoreyMid, hdbDistanceM } = candidate
const centres = { woodlands: [1.443373439, 103.7887163], bedok: [1.327, 103.932], punggol: [1.403, 103.906], queenstown: [1.294, 103.802] }
const dedup = rows => [...new Map(rows.map(r => [String(r.id), r])).values()].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || Number(a.id) - Number(b.id))
const snapshots = {}, hashes = {}
const blockInfo = fs.readdirSync(dataDir).filter(f => f.startsWith('blockinfo-') && f.endsWith('.json')).flatMap(f => {
  const text = fs.readFileSync(path.join(dataDir, f), 'utf8')
  hashes[f] = crypto.createHash('sha256').update(text).digest('hex')
  return JSON.parse(text)
})
const blockYears = new Map(blockInfo.map(r => [`${r.blk_no}|${r.street}`, r.year_completed]))
const actualCompletionYear = r => blockYears.get(`${r.address?.match(/^(\d+[A-Z]?)\s/)?.[1] || ''}|${subjectHdbStreetKey(null, r.address)}`) ?? null
const actualYearRows = rows => rows.map(r => ({ ...r, completion_year: actualCompletionYear(r) }))
for (const key of Object.keys(centres)) {
  const files = fs.readdirSync(dataDir).filter(f => f.startsWith(key) && f.endsWith('.json')).sort()
  snapshots[key] = dedup(files.flatMap(f => {
    const text = fs.readFileSync(path.join(dataDir, f), 'utf8')
    hashes[f] = crypto.createHash('sha256').update(text).digest('hex')
    return JSON.parse(text)
  }))
}
const clock = { time: Date.now() }
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock.time])) }
  static now() { return clock.time }
}
function legacyEngine(rows) {
  return loadTs(path.join(root, 'src/lib/valuation.ts'), { DateClass: TestDate, overrides: {
    './supabase': { supabase: snapshotSupabase(rows) },
    './hdbValuationCandidateData': { getHdbCandidateValuation: () => { throw new Error('Legacy replay must not invoke candidate provider') } },
  } })
}
function subject(r, date) {
  return {
    lat: Number(r.latitude), lon: Number(r.longitude), floorAreaSqm: Number(r.floor_area_sqm),
    floorLevel: hdbStoreyMid(r.floor_level) || undefined, propertyType: r.unit_type,
    propertyCategory: 'hdb', subjectAddress: r.address,
    subjectBlockNo: r.address.match(/^(\d+[A-Z]?)\s/)?.[1] || '',
    subjectCompletionYearHdb: Number(r.completion_year) || null, valuationDate: date,
  }
}
const money = n => n == null ? null : Math.round(n)
function compact(r) {
  return r && {
    estimate: money(r.estimated), low: money(r.low), high: money(r.high), method: r.method,
    rawCount: r.comparables, effectiveN: r.effectiveComparables, maxWeightPct: r.maxComparableWeightPct,
    confidence: r.confidence, stage: r.selectionStage, recentNearbyUsed: r.recentNearbyUsed,
  }
}
function ratioVariant(zeroFloor, floor) {
  if (!zeroFloor) return null
  const usable = zeroFloor.evidence.filter(r => r.floorMidpoint != null)
  const den = usable.reduce((s, r) => s + Math.pow(0.5, r.ageDays / 120), 0)
  const avg = den ? usable.reduce((s, r) => s + r.floorMidpoint * Math.pow(0.5, r.ageDays / 120), 0) / den : null
  const mult = avg && floor ? Math.max(0.9, Math.min(1.1, Math.pow(floor / avg, 0.0535))) : 1
  return { ...zeroFloor, estimated: zeroFloor.estimated * mult, low: zeroFloor.low * mult, high: zeroFloor.high * mult }
}
const median = values => {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2
}
const percentile = (v, p) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b), index = (s.length - 1) * p, lo = Math.floor(index), hi = Math.ceil(index)
  return s[lo] + (s[hi] - s[lo]) * (index - lo)
}

async function main() {
  const caseParams = {
    lat: centres.woodlands[0], lon: centres.woodlands[1], floorAreaSqm: 131, floorLevel: 11,
    propertyType: '5 ROOM', propertyCategory: 'hdb', subjectAddress: '870 WOODLANDS ST 81',
    subjectBlockNo: '870', subjectStreetName: 'WOODLANDS ST 81', subjectCompletionYearHdb: 1996,
  }
  const cases = []
  for (const date of ['2026-08-31', '2026-09-30']) {
    // Opening-September evidence uses an August-31 cutoff. Month-resolution
    // dates cannot establish when September's sale became available to the tool.
    const rows = snapshots.woodlands.filter(r => r.transaction_date <= date)
    clock.time = new Date(`${date}T00:00:00.000Z`).getTime()
    const before = await legacyEngine(rows).getValuation(caseParams)
    const after = build(actualYearRows(rows), { ...caseParams, subjectCompletionYearHdb: actualCompletionYear({ address: caseParams.subjectAddress }), valuationDate: date })
    cases.push({ valuationDate: date, septemberSalesIncluded: date === '2026-09-30', before: compact(before), after: compact(after), evidence: after?.evidence })
  }
  const results = []
  for (const [town, centre] of Object.entries(centres)) {
    const all = snapshots[town]
    const possible = all.filter(r => r.transaction_date >= '2026-07-01' && r.transaction_date <= '2026-09-01' &&
      ['3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE'].includes(r.unit_type) && Number(r.transaction_price) > 0 &&
      Number(r.floor_area_sqm) > 0 && hdbStoreyMid(r.floor_level) && hdbDistanceM(centre[0], centre[1], Number(r.latitude), Number(r.longitude)) <= 500)
    // Stratify thin/fresh blocks and low/middle/high storeys. Stable hashes avoid
    // choosing examples based on either model's result or known sale price.
    possible.sort((a, b) => crypto.createHash('sha256').update(String(a.id)).digest('hex').localeCompare(crypto.createHash('sha256').update(String(b.id)).digest('hex')))
    const buckets = new Map()
    for (const r of possible) {
      const date = new Date(`${r.transaction_date}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() - 1)
      const p = subject(r, date.toISOString().slice(0, 10))
      const boundary = new Date(date); boundary.setUTCFullYear(boundary.getUTCFullYear() - 1)
      const n = all.filter(c => c.address === r.address && c.unit_type === r.unit_type && c.transaction_date < r.transaction_date && c.transaction_date >= boundary.toISOString().slice(0, 10) && Math.abs(Number(c.floor_area_sqm) / p.floorAreaSqm - 1) <= 0.1).length
      const band = p.floorLevel <= 5 ? 'low' : p.floorLevel >= 14 ? 'high' : 'middle'
      const key = `${n < 3 ? 'thin' : 'fresh'}_${band}`
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push({ row: r, params: p, stratum: key })
    }
    let chosen = [...buckets.values()].flatMap(b => b.slice(0, 5))
    const selected = new Set(chosen.map(c => c.row.id))
    const remaining = [...buckets.values()].flat().filter(c => !selected.has(c.row.id)).sort((a, b) => Number(a.row.id) - Number(b.row.id))
    chosen = [...chosen, ...remaining.slice(0, Math.max(0, 30 - chosen.length))]
    for (const { row: r, params: p, stratum } of chosen) {
      // Exclude the entire target month, not just the target row: within-month
      // ordering is unknowable in source data and must not leak into backtests.
      const pool = all.filter(c => c.transaction_date < r.transaction_date)
      clock.time = new Date(`${p.valuationDate}T00:00:00Z`).getTime()
      const before = await legacyEngine(pool).getValuation({ ...p, valuationDate: undefined })
      const consistent = actualYearRows(pool)
      const candidateParams = { ...p, subjectCompletionYearHdb: actualCompletionYear(r) }
      const after = build(consistent, candidateParams)
      const noFloor = build(consistent, candidateParams, 0)
      const variants = { legacy: before, candidate_05: after, candidate_no_floor: noFloor, candidate_03: build(consistent, candidateParams, 0.003), candidate_075: build(consistent, candidateParams, 0.0075), candidate_ratio: ratioVariant(noFloor, p.floorLevel) }
      const actual = Number(r.transaction_price)
      const record = { town, id: String(r.id), address: r.address, unitType: r.unit_type, areaSqm: p.floorAreaSqm, floor: p.floorLevel, transactionMonth: r.transaction_date, valuationDate: p.valuationDate, stratum, actual, models: {} }
      for (const [name, value] of Object.entries(variants)) record.models[name] = value && {
        ...compact(value), apePct: Math.abs(value.estimated / actual - 1) * 100,
        signedErrorPct: (value.estimated / actual - 1) * 100, covered: actual >= value.low && actual <= value.high,
      }
      results.push(record)
    }
    console.log(`${town}: ${chosen.length} held-out cases`)
  }
  const names = ['legacy', 'candidate_05', 'candidate_no_floor', 'candidate_03', 'candidate_075', 'candidate_ratio']
  function summary(records) {
    return Object.fromEntries(names.map(name => {
      const available = records.map(r => r.models[name]).filter(Boolean)
      return [name, { available: available.length, targets: records.length, coveragePct: available.length / records.length * 100,
        medianApePct: median(available.map(r => r.apePct)), p90ApePct: percentile(available.map(r => r.apePct), 0.9),
        medianSignedErrorPct: median(available.map(r => r.signedErrorPct)), rangeCoveragePct: available.length ? available.filter(r => r.covered).length / available.length * 100 : null }]
    }))
  }
  const common = results.filter(r => r.models.legacy && r.models.candidate_05)
  const report = {
    generatedAt: new Date().toISOString(), baselineCommit: '54759932c7d76ef5f56f7d7c44e1d6a6130df665',
    scope: 'Four local neighbourhoods; July–September 2026 held-out transactions; 30 cases per neighbourhood where available. Candidate uses hdb_block_info actual completion years for subject and comparables; legacy retains its lease-commencement proxy.',
    limitations: ['Not a nationwide validation or a reproduction of the repository comment backtests.', 'Snapshots for Bedok/Punggol/Queenstown start January 2023; Woodlands includes all 5 ROOM history since January 2017 and other types since July 2022.', 'Legacy all-type anchor query has no ordering; replay uses deterministic snapshot date/id order.', 'HDB dates are month-resolution; holdout excludes the entire target month.', 'Ranges are provisional quality bands, not calibrated statistical confidence intervals.'],
    snapshotCounts: Object.fromEntries(Object.entries(snapshots).map(([key, rows]) => [key, rows.length])), snapshotHashes: hashes,
    block870: cases, allTargets: summary(results), commonTargets: summary(common),
    byTown: Object.fromEntries(Object.keys(centres).map(town => [town, summary(results.filter(r => r.town === town))])),
    byStratum: Object.fromEntries([...new Set(results.map(r => r.stratum))].sort().map(s => [s, summary(results.filter(r => r.stratum === s))])),
    byConfidence: Object.fromEntries(['High', 'Moderate', 'Low'].map(c => [c, summary(results.filter(r => r.models.candidate_05?.confidence === c))])),
    results,
  }
  fs.writeFileSync(path.join(outDir, 'hdb-backtest.json'), JSON.stringify(report, null, 2))
  const csv = [['Town', 'Address', 'Type', 'Area sqm', 'Floor', 'Sale month', 'Valuation date', 'Stratum', 'Actual price', 'Before', 'After', 'Before APE %', 'After APE %', 'After low', 'After high', 'Confidence', 'Raw count', 'Effective N', 'Max weight %', 'Method']]
  for (const r of results) {
    const b = r.models.legacy, a = r.models.candidate_05
    csv.push([r.town, r.address, r.unitType, r.areaSqm, r.floor, r.transactionMonth, r.valuationDate, r.stratum, r.actual, b?.estimate, a?.estimate, b?.apePct, a?.apePct, a?.low, a?.high, a?.confidence, a?.rawCount, a?.effectiveN, a?.maxWeightPct, a?.method])
  }
  fs.writeFileSync(path.join(outDir, 'hdb-before-after.csv'), csv.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n') + '\n')
  console.log(JSON.stringify({ cases: report.block870.map(r => ({ valuationDate: r.valuationDate, before: r.before, after: r.after })), all: report.allTargets, common: report.commonTargets }, null, 2))
}
main().catch(error => { console.error(error); process.exitCode = 1 })

/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests. */
const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const { loadTs, snapshotSupabase } = require('../scripts/hdb_valuation/load-ts.cjs')
const root = path.resolve(__dirname, '..')
const { buildHdbCandidateV2: build, hdbWeightDiagnostics, hdbDifferenceFloorMultiplier, hdbAsOf } = loadTs(path.join(root, 'src/lib/hdbValuationCandidate.ts'))
const params = { lat: 1.443373439, lon: 103.7887163, floorAreaSqm: 131, propertyType: '5 ROOM', floorLevel: 11, subjectBlockNo: '870', subjectStreetName: 'Woodlands Street 81', subjectCompletionYearHdb: 1996, valuationDate: '2026-09-01' }
const row = (id, address = '870 WOODLANDS ST 81', extra = {}) => ({ id, address, unit_type: '5 ROOM', floor_area_sqm: 131, floor_level: '10 TO 12', transaction_price: 700000, transaction_date: '2026-08-01', completion_year: 1996, latitude: params.lat, longitude: params.lon, property_group: 'hdb', ...extra })
const near = Array.from({ length: 4 }, (_, i) => row(i + 10, `${871 + i} WOODLANDS ST 81`, { longitude: params.lon + 0.001 * (i + 1) }))

test('floor difference: 2 to 11 = 4.5%; symmetric ±5% cap; missing floors neutral', () => {
  assert.ok(Math.abs(hdbDifferenceFloorMultiplier(11, 2) - 1.045) < 1e-12)
  assert.equal(hdbDifferenceFloorMultiplier(50, 2), 1.05)
  assert.equal(hdbDifferenceFloorMultiplier(2, 50), 0.95)
  assert.equal(hdbDifferenceFloorMultiplier(undefined, 2), 1)
})
test('effective count detects concentration', () => {
  assert.equal(hdbWeightDiagnostics([1, 1, 1]).effectiveComparables, 3)
  const d = hdbWeightDiagnostics([98, 1, 1])
  assert.equal(d.maxComparableWeightPct, 98)
  assert.ok(d.effectiveComparables < 2)
})
test('three healthy recent block sales take priority; nearby evidence excluded', () => {
  const r = build([row(1), row(2), row(3), ...near], params)
  assert.equal(r.method, 'hdb_v2_recent_same_block')
  assert.equal(r.comparables, 3)
  assert.equal(r.confidence, 'High')
  assert.ok(Math.abs(r.rangeHalfWidthPct - 3) < 1e-10)
})
test('one recent block sale is supplemented, with final weights and warning', () => {
  const r = build([row(1), ...near], params)
  assert.ok(r.recentNearbyUsed)
  assert.ok(r.effectiveComparables >= 2)
  assert.ok(r.maxComparableWeightPct <= 70)
  assert.equal(r.thinDataWarning, true)
  assert.ok(Math.abs(r.evidence.reduce((s, x) => s + x.weightPct, 0) - 100) < 1e-9)
  assert.ok(r.rangeHalfWidthPct >= 7)
})
test('dominant raw block pool forces nearby supplementation despite >=3 rows', () => {
  const r = build([row(1), row(2, undefined, { transaction_date: '2025-10-01', floor_level: '01 TO 03', floor_area_sqm: 143 }), row(3, undefined, { transaction_date: '2025-10-01', floor_level: '01 TO 03', floor_area_sqm: 143 }), ...near], params)
  assert.equal(r.recentNearbyUsed, true)
  assert.equal(r.thinDataWarning, true)
})
test('older block support is capped collectively; >24m historical only', () => {
  const r = build([row(1, undefined, { transaction_date: '2025-01-01' }), row(2, undefined, { transaction_date: '2023-01-01' }), ...near], params)
  assert.ok(r.evidence.filter(x => x.role === 'older_same_block').reduce((s, x) => s + x.weightPct, 0) <= 25)
  assert.ok(r.evidence.every(x => x.id !== '2'))
  assert.equal(r.historicalReferenceCount, 1)
})
test('future sales, wrong types, duplicates and bad coordinates cannot leak into pool', () => {
  const r = build([...near, near[0], row(1, undefined, { transaction_date: '2026-10-01' }), row(2, undefined, { unit_type: '4 ROOM' }), row(3, undefined, { latitude: null })], params)
  assert.equal(r.comparables, 4)
  assert.ok(r.evidence.every(x => x.transactionDate <= params.valuationDate))
})
test('block number collisions on another street are nearby, never same-block', () => {
  const r = build([row(1, '870 OTHER RD'), ...near], params)
  assert.equal(r.method, 'hdb_v2_recent_nearby')
  assert.ok(r.evidence.every(x => x.role === 'recent_nearby'))
})
test('strict year filters relax explicitly when necessary; broad fallback is Low confidence', () => {
  const r = build(near.map(r => ({ ...r, completion_year: 1970, floor_area_sqm: 150 })), params)
  assert.equal(r.confidence, 'Low')
  assert.ok(r.selectionStage.startsWith('broad_'))
  assert.ok(r.rangeHalfWidthPct >= 10)
})
test('unsupported thin/stale-only pool produces no point estimate', () => {
  assert.equal(build([row(1)], params), null)
  assert.equal(build([row(1, undefined, { transaction_date: '2025-01-01' })], params), null)
})
test('invalid date rejected and exact calendar 12-month boundary remains recent', () => {
  assert.throws(() => hdbAsOf('2026-02-30'))
  const r = build([row(1), row(2), row(3, undefined, { transaction_date: '2025-09-01' })], params)
  assert.equal(r.method, 'hdb_v2_recent_same_block')
})
test('Block 870 general-rule regression remains near $700k without narrow forced range', () => {
  const fixture = require('./fixtures/hdb-block-870.json')
  const rows = fixture.transactions.map(r => ({ ...r, completion_year: r.actual_completion_year }))
  for (const date of ['2026-08-31', '2026-09-30']) {
    const r = build(rows, { ...fixture.subject, valuationDate: date })
    assert.ok(r.estimated > 680000 && r.estimated < 725000)
    assert.equal(r.recentNearbyUsed, true)
    assert.ok(r.effectiveComparables >= 2)
    assert.ok(r.maxComparableWeightPct <= 70)
    assert.ok(r.rangeHalfWidthPct >= 7)
    assert.ok(r.evidence.every(c => c.transactionDate <= date))
    const older = r.evidence.find(c => c.role === 'older_same_block')
    if (older) assert.ok(Math.abs(older.floorAdjustmentPct - 4.5) < 1e-9)
  }
})
test('opt-in entry bypasses legacy cache and does not change defaults', async () => {
  const source = require('node:fs').readFileSync(path.join(root, 'src/lib/valuation.ts'), 'utf8')
  let called = 0
  const candidate = build(near, params)
  const engine = loadTs(path.join(root, 'src/lib/valuation.ts'), { overrides: {
    './supabase': { supabase: snapshotSupabase([]) },
    './hdbValuationCandidateData': { getHdbCandidateValuation: async () => { called++; return candidate } },
  } })
  const r = await engine.getValuation({ ...params, propertyCategory: 'hdb', hdbModel: 'candidate_v2', cacheKey: 'must-not-touch' })
  assert.equal(called, 1)
  assert.equal(r.hdbDiagnostics.modelVersion, 'hdb_candidate_v2')
  assert.ok(source.indexOf("params.hdbModel === 'candidate_v2'") < source.indexOf('const result = await getValuationCore(params)'))
  const legacy = await engine.getValuation({ ...params, valuationDate: undefined, propertyCategory: 'hdb', subjectCompletionYearHdb: 1996 })
  assert.equal(legacy, null)
  assert.equal(called, 1)
})
test('data provider paginates, deduplicates history, and uses actual completion years', async () => {
  const rows = [...near, row(1)]
  for (let i = 0; i < 505; i++) rows.push(row(100 + i, `${900 + i} WOODLANDS ST 81`, { longitude: params.lon + 0.015 }))
  const info = [...new Set(rows.map(r => r.address))].map(address => ({ blk_no: address.split(' ')[0], street: 'WOODLANDS ST 81', year_completed: 1994 }))
  const reads = []
  const provider = loadTs(path.join(root, 'src/lib/hdbValuationCandidateData.ts'), { overrides: {
    './supabase': { supabase: snapshotSupabase(rows, { blockInfo: info, onRead: table => reads.push(table) }) },
  } })
  // Caller passes the old lease proxy. The block reference takes precedence.
  const r = await provider.getHdbCandidateValuation(params)
  assert.equal(r.completionYear, 1994)
  assert.equal(r.ageBasis, 'block_completion_year')
  assert.ok(r.evidence.every(c => c.completionYear === 1994))
  assert.equal(r.comparables, 5)
  assert.equal(reads.filter(t => t === 'property_transactions_v2').length, 3)
  assert.equal(reads.filter(t => t === 'hdb_block_info').length, 2)
})
test('candidate query errors fail visibly rather than becoming a partial estimate', async () => {
  const provider = loadTs(path.join(root, 'src/lib/hdbValuationCandidateData.ts'), { overrides: {
    './supabase': { supabase: snapshotSupabase(near, { errors: { property_transactions_v2: { message: 'test failure' } } }) },
  } })
  await assert.rejects(provider.getHdbCandidateValuation(params), /neighbourhood query failed/)
})

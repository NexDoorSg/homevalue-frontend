/* eslint-disable @typescript-eslint/no-require-imports -- Offline Node test harness. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('../scripts/hdb_valuation/load-ts.cjs')

function route(rows, { masterName = 'THE AZURE', fail = false, stats = false, propertyType = 'Condominium' } = {}) {
  const queried = []
  const supabase = { from(table) {
    assert.ok(['property_transactions_v2', 'projects_master'].includes(table))
    let filtered = [...rows], head = false, from = 0, to = Infinity
    const query = {
      select(_, options) { head = options?.head; return this },
      ilike() { return this }, limit() { return this },
      maybeSingle() { return Promise.resolve({ data: { project_name: masterName, property_type: propertyType } }) },
      eq(k, v) { queried.push(v); filtered = filtered.filter(r => r[k] === v); return this },
      like() { filtered = filtered.filter(r => r.address?.includes('#')); return this },
      order() { return this }, range(a, b) { from = a; to = b; return this },
      then(resolve, reject) { return Promise.resolve({ data: head ? null : filtered.slice(from, to + 1), count: filtered.length, error: fail ? { message: 'test failure' } : null }).then(resolve, reject) },
    }
    return query
  } }
  const handler = loadTs(`src/app/api/projects/[slug]/${stats ? 'stats' : 'tower'}/route.ts`, { overrides: {
    '@/lib/supabase': { supabase },
    'next/server': { NextResponse: { json: (body, init) => ({ body, status: init.status }) } },
  } })
  return { queried, get: (block = '') => handler.GET({ nextUrl: new URL('https://example.test?block=' + block) }, { params: Promise.resolve({ slug: masterName }) }) }
}

const tx = (address, price = 1000000, date = '2020-01-01', project = 'THE AZURE') => ({ address, transaction_price: price, transaction_date: date, price_psf: 1000, floor_area_sqm: 100, project_name: project })

test('bulk, basement, HTML entities and multiple # cannot contaminate unit histories', async () => {
  const rows = [tx('201 OCEAN DRIVE #04-06'), tx('201 OCEAN DRIVE #04-06', 1200000, '2024-01-01'), tx('201 OCEAN DRIVE #04-06 ETC', 999000000), tx('201 (ENBLOC) OCEAN DRIVE #04-06'), tx('201 OCEAN DRIVE #B1-02'), tx('201 OCEAN DRIVE #04-06#05-07'), tx('201 OCEAN DRIVE'), tx('1 KING&#039;S ROAD')]
  const { body, status } = await route(rows).get()
  assert.equal(status, 200)
  assert.equal(body.coverage.totalTransactionRecords, 8)
  assert.equal(body.coverage.unitAddressRecords, 2)
  assert.equal(body.floors[4][6].transactionCount, 2)
  assert.equal(body.floors[4][6].profitAmount, 200000)
})

test('lettered blocks stay separate, histories deduplicate, and requested tower is selected', async () => {
  const a = tx('9G YUAN CHING ROAD #01-01')
  const { body } = await route([a, a, tx('9H YUAN CHING ROAD #02-02')]).get('9H')
  assert.deepEqual(Array.from(body.blocks), ['9G', '9H'])
  assert.equal(body.selectedBlock, '9H')
  assert.equal(body.floors[2][2].transactionCount, 1)
})

test('legacy ENCHANTÉ mapping remains exact', async () => {
  const r = route([tx('3 EVELYN ROAD #03-01', 1000000, '2024-01-01', 'ENCHANTÉ')], { masterName: 'ENCHANTÃ‰' })
  const { body } = await r.get()
  assert.equal(body.projectName, 'ENCHANTÃ‰')
  assert.equal(body.coverage.totalTransactionRecords, 1)
  assert.ok(r.queried.every(name => name === 'ENCHANTÉ'))
})

test('database failures return an error instead of empty coverage', async () => {
  assert.equal((await route([], { fail: true }).get()).status, 500)
})

test('projects with only building addresses retain honest coverage', async () => {
  const { body } = await route([tx('201 OCEAN DRIVE')]).get()
  assert.equal(body.blocks.length, 0)
  assert.equal(body.coverage.buildingOnlyRecords, 1)
})

test('directory stats preserve ENCHANTÉ alias and exclude bulk prices', async () => {
  const rows = [tx('3 EVELYN ROAD #03-01', 1000000, '2020-01-01', 'ENCHANTÉ'), tx('3 EVELYN ROAD #03-01', 1200000, '2024-01-01', 'ENCHANTÉ'), tx('3 EVELYN ROAD #03-01 ETC', 999000000, '2024-01-01', 'ENCHANTÉ')]
  rows[2].price_psf = 999999
  const r = route(rows, { masterName: 'ENCHANTÃ‰', stats: true })
  const { body } = await r.get()
  assert.equal(body.profitability.profitable, 1)
  assert.equal(body.priceHistory[1].avg_psf, 1000)
  assert.ok(r.queried.every(name => name === 'ENCHANTÉ'))
})

test('directory condo profitability excludes unidentified units and basements', async () => {
  const rows = ['201 OCEAN DRIVE', '201 OCEAN DRIVE #B1-02', '201 OCEAN DRIVE #04-06#05-07'].flatMap(a => [tx(a), tx(a, 1200000, '2024-01-01')])
  assert.equal((await route(rows, { stats: true }).get()).body.profitability.total_with_2_transactions, 0)
})

test('landed profitability still accepts exact building addresses', async () => {
  const rows = [tx('1 EXAMPLE ROAD'), tx('1 EXAMPLE ROAD', 1200000, '2024-01-01')]
  assert.equal((await route(rows, { stats: true, propertyType: 'Terrace House' }).get()).body.profitability.profitable, 1)
})

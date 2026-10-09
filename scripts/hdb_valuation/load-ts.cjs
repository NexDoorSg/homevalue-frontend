/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS offline harness. */
// Offline-only loader. Transpiles repository TS without credentials or network.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(entry, { overrides = {}, DateClass = Date } = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file).exports
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'))
    const loadedModule = { exports: {} }
    cache.set(file, loadedModule)
    const source = fs.readFileSync(file, 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
    const localRequire = spec => {
      if (spec in overrides) return overrides[spec]
      if (!spec.startsWith('.')) throw new Error(`Unexpected external dependency: ${spec}`)
      const base = path.resolve(path.dirname(file), spec)
      const resolved = fs.existsSync(base) && fs.statSync(base).isFile() ? base : `${base}.ts`
      return load(resolved)
    }
    const context = vm.createContext({ module: loadedModule, exports: loadedModule.exports, require: localRequire, Date: DateClass, console })
    vm.runInContext(code, context, { filename: file })
    return loadedModule.exports
  }
  return load(entry)
}

function frozenDate(iso) {
  const time = new Date(`${iso}T00:00:00.000Z`).getTime()
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [time])) }
    static now() { return time }
  }
}

// Replays the real legacy Supabase query chain against an immutable snapshot.
function snapshotSupabase(rows, { blockInfo = [], onRead = () => {}, errors = {} } = {}) {
  return { from(table) {
    if (!['property_transactions_v2', 'hdb_block_info'].includes(table)) throw new Error(`Unexpected table: ${table}`)
    onRead(table)
    let filtered = [...(table === 'hdb_block_info' ? blockInfo : rows)], orders = [], max = Infinity, offset = 0
    const query = {
      select() { return this },
      eq(k, v) { filtered = filtered.filter(r => r[k] === v); return this },
      gte(k, v) { filtered = filtered.filter(r => r[k] >= v); return this },
      lte(k, v) { filtered = filtered.filter(r => r[k] <= v); return this },
      not(k) { filtered = filtered.filter(r => r[k] != null); return this },
      in(k, v) { filtered = filtered.filter(r => v.includes(r[k])); return this },
      order(k, o = { ascending: true }) { orders.push([k, o.ascending]); return this },
      limit(n) { max = n; return this },
      range(start, end) { offset = start; max = end - start + 1; return this },
      then(resolve, reject) {
        filtered.sort((a, b) => {
          for (const [k, asc] of orders) { const d = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0; if (d) return asc ? d : -d }
          return 0
        })
        return Promise.resolve({ data: filtered.slice(offset, offset + max), error: errors[table] || null }).then(resolve, reject)
      },
    }
    return query
  } }
}

module.exports = { loadTs, frozenDate, snapshotSupabase }

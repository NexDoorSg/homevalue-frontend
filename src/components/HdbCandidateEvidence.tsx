import type { HdbCandidateResult } from '@/lib/hdbValuationCandidate'

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const METHODS: Record<string, string> = {
  hdb_v2_recent_same_block: 'Recent matched same-block sales',
  hdb_v2_recent_block_nearby_blend: 'Recent same-block sales supported by nearby matches',
  hdb_v2_recent_nearby_older_block_support: 'Recent nearby matches with older same-block support',
  hdb_v2_recent_nearby: 'Recent nearby matched sales',
}

export default function HdbCandidateEvidence({ result }: { result: HdbCandidateResult }) {
  return <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
    <h2 className="text-lg font-semibold">Candidate valuation evidence</h2>
    <p className="mt-2">{METHODS[result.method] || result.method}</p>
    <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
      <div><dt>Confidence</dt><dd className="font-semibold">{result.confidence}</dd></div>
      <div><dt>Transactions used</dt><dd>{result.comparables}</dd></div>
      <div><dt>Effective comparable count</dt><dd>{result.effectiveComparables.toFixed(2)}</dd></div>
      <div><dt>Largest individual weight</dt><dd>{result.maxComparableWeightPct.toFixed(1)}%</dd></div>
      <div><dt>Newest same-type block sale</dt><dd>{result.newestSameBlockAgeDays == null ? 'None recorded' : `${Math.round(result.newestSameBlockAgeDays)} days old`}</dd></div>
      <div><dt>Recent nearby sales used</dt><dd>{result.recentNearbyUsed ? 'Yes' : 'No'}</dd></div>
      <div><dt>Valuation date</dt><dd>{result.valuationDate}</dd></div>
      <div><dt>Block completion year</dt><dd>{result.completionYear ?? 'Unknown'}</dd></div>
      <div><dt>Historical references</dt><dd>{result.historicalReferenceCount} (zero price weight)</dd></div>
    </dl>
    <p className="mt-4 text-sm">The ±{result.rangeHalfWidthPct.toFixed(1)}% range is a provisional evidence-quality band, not a statistically calibrated confidence interval.</p>
    {result.warnings.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm">{result.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="mb-2 text-left">Exact calculation pool; adjusted prices reflect subject area and floor.</caption>
        <thead><tr>{['Address', 'Date', 'Area (sqm)', 'Floor midpoint', 'Distance', 'Sale price', 'Adjusted price', 'Floor change', 'Weight'].map(h => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
        <tbody>{result.evidence.map(r => <tr key={r.id} className="border-t border-amber-200">
          <td className="px-2 py-2">{r.address}<br />{r.role.replaceAll('_', ' ')}</td>
          <td className="px-2 py-2">{r.transactionDate}</td><td className="px-2 py-2">{r.areaSqm}</td>
          <td className="px-2 py-2">{r.floorMidpoint ?? 'Unknown'}</td><td className="px-2 py-2">{Math.round(r.distanceM)}m</td>
          <td className="px-2 py-2">{money(r.price)}</td><td className="px-2 py-2">{money(r.adjustedPrice)}</td>
          <td className="px-2 py-2">{r.floorAdjustmentPct.toFixed(1)}%</td><td className="px-2 py-2">{r.weightPct.toFixed(1)}%</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}

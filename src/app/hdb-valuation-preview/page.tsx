'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { subjectHdbStreetKey } from '@/lib/hdbStreetAbbrev'
import { getValuation } from '@/lib/valuation'
import type { HdbCandidateResult } from '@/lib/hdbValuationCandidate'
import HdbCandidateEvidence from '@/components/HdbCandidateEvidence'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })

export default function HdbValuationPreview() {
  const [address, setAddress] = useState('870 Woodlands Street 81')
  const [flatType, setFlatType] = useState('5 ROOM')
  const [area, setArea] = useState('131')
  const [floor, setFloor] = useState('11')
  const [date, setDate] = useState(today)
  const [result, setResult] = useState<HdbCandidateResult | null>(null)
  const [baseline, setBaseline] = useState<{ estimated: number; low: number; high: number } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function calculate(event: React.FormEvent) {
    event.preventDefault()
    // Read the submitted date from the form as well as React state. Native date
    // controls can commit their edit only when focus leaves the field.
    const requestedDate = String(new FormData(event.currentTarget as HTMLFormElement).get('valuationDate') || date)
    setDate(requestedDate)
    setBusy(true); setMessage(''); setResult(null); setBaseline(null)
    try {
      const block = address.toUpperCase().trim().match(/^(\d+[A-Z]?)\s/)?.[1]
      const street = subjectHdbStreetKey(null, address)
      if (!block || !street) throw new Error('Enter a block number and street, such as 870 Woodlands Street 81.')
      const canonicalAddress = `${block} ${street}`
      const { data, error } = await supabase.from('property_transactions_v2')
        .select('latitude,longitude,completion_year').eq('property_group', 'hdb').eq('address', canonicalAddress)
        .lte('transaction_date', requestedDate).not('latitude', 'is', null).not('longitude', 'is', null)
        .order('transaction_date', { ascending: false }).limit(1)
      if (error) throw new Error(error.message)
      if (!data?.length) throw new Error('This preview could not locate the block from its recorded sales. Try a block with resale history.')
      const { data: info } = await supabase.from('hdb_block_info').select('year_completed').eq('blk_no', block).eq('street', street).maybeSingle()
      const params = {
        lat: Number(data[0].latitude), lon: Number(data[0].longitude), floorAreaSqm: Number(area),
        floorLevel: Number(floor), propertyType: flatType, propertyCategory: 'hdb' as const,
        subjectAddress: canonicalAddress, subjectStreetName: street, subjectBlockNo: block,
        subjectCompletionYearHdb: Number(info?.year_completed || data[0].completion_year) || null,
      }
      const candidate = await getValuation({ ...params, hdbModel: 'candidate_v2', valuationDate: requestedDate })
      if (!candidate?.hdbDiagnostics) throw new Error('Insufficient independent recent comparables after expanding the search. No candidate estimate was produced.')
      setResult(candidate.hdbDiagnostics)
      // Historical legacy replay lives in the offline harness. The production
      // legacy engine uses today's clock, so do not label it as a past estimate.
      if (requestedDate === today()) setBaseline(await getValuation({ ...params, subjectCompletionYearHdb: Number(data[0].completion_year) || null }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to calculate the preview.')
    } finally { setBusy(false) }
  }
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`
  return <main className="mx-auto max-w-6xl p-6 text-slate-800">
    <h1 className="text-3xl font-semibold">HDB valuation research preview</h1>
    <p className="mt-3">Compare the candidate rules before rollout. This page reads public transaction data and does not save leads or valuation-cache entries.</p>
    <p className="mt-2 text-sm text-slate-600">Transaction dates identify a month, not an exact sale or publication day. Historical results use the currently available dataset; they do not recreate what was published at the time.</p>
    <form onSubmit={calculate} className="mt-6 grid gap-4 rounded-xl border p-5 md:grid-cols-3">
      <label className="md:col-span-2">Block and street<input required value={address} onChange={e => setAddress(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label>Flat type<select value={flatType} onChange={e => setFlatType(e.target.value)} className="mt-1 w-full rounded border p-2">{['1 ROOM', '2 ROOM', '3 ROOM', '4 ROOM', '5 ROOM', 'EXECUTIVE', 'MULTI-GENERATION'].map(t => <option key={t}>{t}</option>)}</select></label>
      <label>Area (sqm)<input required type="number" min="1" step="0.01" value={area} onChange={e => setArea(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label>Floor level<input required type="number" min="1" max="60" value={floor} onChange={e => setFloor(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <label>Valuation date<input required name="valuationDate" type="date" max={today()} value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <button disabled={busy} className="rounded bg-slate-800 p-3 text-white disabled:opacity-50">{busy ? 'Calculating…' : 'Calculate preview'}</button>
    </form>
    {message && <p role="alert" className="mt-4 text-red-700">{message}</p>}
    {result && <>
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-5"><h2>Candidate model</h2><p className="mt-2 text-3xl font-semibold">{money(result.estimated)}</p><p>{money(result.low)} – {money(result.high)}</p></div>
        <div className="rounded-xl border p-5"><h2>Current model</h2>{baseline ? <><p className="mt-2 text-3xl font-semibold">{money(baseline.estimated)}</p><p>{money(baseline.low)} – {money(baseline.high)}</p></> : <p className="mt-2">Live comparison is available for today&apos;s date. Historical before-and-after comparisons are provided in the backtest report.</p>}</div>
      </section>
      <HdbCandidateEvidence result={result} />
    </>}
  </main>
}

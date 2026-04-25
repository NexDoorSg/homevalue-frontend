'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../../../../lib/supabase'

type RecentTransaction = {
  id?: number | string
  transaction_date?: string
  display_name?: string
  project_name?: string
  address?: string
  unit_type?: string
  floor_area_sqft?: number
  floor_level?: string
  transaction_price?: number
  price_psf?: number
  distance_m?: number
}

type CompetingListing = {
  title?: string
  listing_url?: string
  asking_price?: string | number
  size_sqft?: string | number
  psf?: string | number
  condition?: string
  source?: string
  notes?: string
}

type Report = {
  id: number
  created_at: string | null
  updated_at: string | null
  client_name: string | null
  client_phone: string | null
  client_email: string | null
  agent_name: string | null
  property_address: string | null
  unit_number: string | null
  property_type: string | null
  property_category: string | null
  floor_area_sqm: number | string | null
  floor_level: string | null
  tenure: string | null
  completion_year: number | string | null
  land_size_sqm: number | string | null
  built_up_sqm: number | string | null
  landed_ownership_type: string | null
  original_low: number | string | null
  original_high: number | string | null
  renovated_low: number | string | null
  renovated_high: number | string | null
  well_renovated_low: number | string | null
  well_renovated_high: number | string | null
  recent_transactions: RecentTransaction[] | null
  competing_listings: CompetingListing[] | null
  suggested_asking_price: number | string | null
  consultant_notes: string | null
}

const AUTHORISED_EMAILS = [
  'bjornlim@nexdoor.sg',
  'abigailtang@nexdoor.sg',
  'daveteo@nexdoor.sg',
]

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function sqmToSqft(value: number | string | null | undefined) {
  const sqm = toNumber(value)
  if (!sqm || sqm <= 0) return null
  return Math.round(sqm * 10.7639)
}

function formatCurrency(value: number | string | null | undefined) {
  const numberValue = toNumber(value)
  if (!numberValue || numberValue <= 0) return '—'
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    maximumFractionDigits: 0,
  }).format(numberValue)
}

function formatCompactCurrency(value: number | string | null | undefined) {
  const numberValue = toNumber(value)
  if (!numberValue || numberValue <= 0) return '—'
  if (numberValue >= 1_000_000) return `$${(numberValue / 1_000_000).toFixed(numberValue % 1_000_000 === 0 ? 0 : 2)}M`
  if (numberValue >= 1_000) return `$${Math.round(numberValue / 1_000)}K`
  return formatCurrency(numberValue)
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })
}

function formatPreparedDate(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
  return date.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDistance(value: number | string | null | undefined) {
  const distance = toNumber(value)
  if (distance === null || distance < 0) return '—'
  if (distance >= 1000) return `${(distance / 1000).toFixed(1)}km`
  return `${Math.round(distance)}m`
}

function normaliseText(value: string | null | undefined) {
  return (value || '').toUpperCase().replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim()
}

function getPropertyCategory(report: Report) {
  const saved = report.property_category as 'hdb' | 'condo' | 'ec' | 'landed' | null
  if (saved === 'hdb' || saved === 'condo' || saved === 'ec' || saved === 'landed') return saved

  const text = normaliseText(report.property_type)
  if (/\b[2345]\s*ROOM\b/.test(text) || text === 'EXECUTIVE') return 'hdb'
  if (text.includes('TERRACE') || text.includes('SEMI') || text.includes('DETACHED') || text.includes('BUNGALOW') || text.includes('GCB')) return 'landed'
  if (text.includes(' EC') || text.endsWith(' EC') || text.includes('EXECUTIVE CONDOMINIUM')) return 'ec'
  return 'condo'
}

function getRemainingLease(tenure: string | null | undefined, completionYear: string | number | null | undefined) {
  const text = normaliseText(tenure)
  const year = toNumber(completionYear)
  if (text.includes('FREEHOLD')) return 'Not applicable'

  let leaseTerm: number | null = null
  if (text.includes('999')) leaseTerm = 999
  else if (text.includes('99')) leaseTerm = 99

  if (!leaseTerm || !year) return '—'
  return `${Math.max(0, Math.round(year + leaseTerm - new Date().getFullYear()))} years remaining`
}

function getLandedOwnershipLabel(value: string | null | undefined) {
  if (value === 'non_strata') return 'Non-strata landed'
  if (value === 'strata_cluster') return 'Strata / cluster landed'
  return '—'
}

function getSecondaryLine(transaction: RecentTransaction, category: string) {
  if (category === 'landed') return transaction.unit_type || ''
  const display = normaliseText(transaction.display_name)
  const project = normaliseText(transaction.project_name)
  const address = normaliseText(transaction.address)
  if (transaction.project_name && project && project !== display) return transaction.project_name
  if (transaction.address && address && address !== display) return transaction.address
  return ''
}

function normaliseTransactions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 15).map((row, index) => {
    const item = row as RecentTransaction
    return {
      id: item.id ?? index,
      transaction_date: item.transaction_date || '',
      display_name: item.display_name || item.project_name || item.address || '',
      project_name: item.project_name || '',
      address: item.address || '',
      unit_type: item.unit_type || '',
      floor_area_sqft: Number(item.floor_area_sqft) || 0,
      floor_level: item.floor_level || '',
      transaction_price: Number(item.transaction_price) || 0,
      price_psf: Number(item.price_psf) || 0,
      distance_m: Number(item.distance_m),
    }
  })
}

function normaliseListings(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 3).map((row) => row as CompetingListing)
}

function rangeText(low: number | string | null | undefined, high: number | string | null | undefined) {
  return `${formatCurrency(low)} – ${formatCurrency(high)}`
}

function InfoItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="info-item">
      <div className="label">{label}</div>
      <div className="value">{value || '—'}</div>
    </div>
  )
}

export default function PrintableReportPage() {
  const params = useParams<{ reportId: string }>()
  const reportId = params?.reportId
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadReport() {
      if (!reportId) return
      setLoading(true)
      setError('')

      const { data: userData } = await supabase.auth.getUser()
      const email = userData.user?.email?.toLowerCase() || ''

      if (!email || !AUTHORISED_EMAILS.includes(email)) {
        setError('You are not authorised to view this report.')
        setLoading(false)
        return
      }

      const { data, error: reportError } = await supabase
        .from('agent_valuation_reports')
        .select('*')
        .eq('id', reportId)
        .single()

      if (reportError || !data) {
        setError('Unable to load report.')
        setLoading(false)
        return
      }

      setReport(data as Report)
      setLoading(false)
    }

    loadReport()
  }, [reportId])

  const category = useMemo(() => (report ? getPropertyCategory(report) : 'condo'), [report])
  const transactions = useMemo(() => normaliseTransactions(report?.recent_transactions), [report])
  const listings = useMemo(() => normaliseListings(report?.competing_listings), [report])

  if (loading) {
    return <main className="screen-shell"><div className="loading-card">Loading print preview…</div></main>
  }

  if (error || !report) {
    return <main className="screen-shell"><div className="loading-card">{error || 'Report not found.'}</div></main>
  }

  const isLanded = category === 'landed'
  const sizeSqft = sqmToSqft(report.floor_area_sqm)
  const landSizeSqft = sqmToSqft(report.land_size_sqm)
  const builtUpSqft = sqmToSqft(report.built_up_sqm)

  return (
    <main className="print-shell">
      <div className="toolbar no-print">
        <Link href={`/agent/reports/report/${report.id}`}>Back to report</Link>
        <button type="button" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>

      <section className="page page-one">
        <header className="report-header">
          <div>
            <div className="eyebrow">NexDoor HomeValue Report</div>
            <h1>Pre-consultation Valuation Report</h1>
            <p>Prepared for {report.client_name || 'Client'}</p>
          </div>
          <div className="header-meta">
            <div><span>Prepared by</span><strong>{report.agent_name || 'NexDoor Consultant'}</strong></div>
            <div><span>Prepared on</span><strong>{formatPreparedDate(report.updated_at || report.created_at)}</strong></div>
          </div>
        </header>

        <section className="section compact-summary">
          <div className="section-title">1. Property Summary</div>
          <div className="summary-grid">
            <InfoItem label="Property address" value={report.property_address} />
            <InfoItem label="Unit number" value={report.unit_number} />
            <InfoItem label="Property type" value={report.property_type} />
            <InfoItem label={isLanded ? 'Floor area / built-up' : 'Floor area'} value={isLanded ? (builtUpSqft ? `${builtUpSqft.toLocaleString()} sqft` : '—') : (sizeSqft ? `${sizeSqft.toLocaleString()} sqft` : '—')} />
            <InfoItem label={isLanded ? 'Landed ownership' : 'Floor category'} value={isLanded ? getLandedOwnershipLabel(report.landed_ownership_type) : report.floor_level} />
            <InfoItem label={isLanded ? 'Land size' : 'Tenure / lease'} value={isLanded ? (landSizeSqft ? `${landSizeSqft.toLocaleString()} sqft` : '—') : report.tenure} />
            <InfoItem label="Lease start / completion year" value={report.completion_year} />
            <InfoItem label="Estimated remaining lease" value={getRemainingLease(report.tenure, report.completion_year)} />
          </div>
        </section>

        <section className="section transactions-section">
          <div className="section-heading-row">
            <div>
              <div className="section-title">2. {category === 'condo' || category === 'ec' ? 'Recent Project Transactions' : 'Recent Nearby Transactions'}</div>
              <p className="section-subtitle">Last 12 months · Showing up to 15 transactions.</p>
            </div>
          </div>

          <table className={isLanded ? 'transactions landed-table' : 'transactions'}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Address / Project</th>
                {!isLanded && <th>Unit Type</th>}
                <th>Size</th>
                <th>Floor</th>
                <th>Price</th>
                <th>PSF</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length > 0 ? transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDate(transaction.transaction_date)}</td>
                  <td>
                    <strong>{transaction.display_name || transaction.project_name || transaction.address || '—'}</strong>
                    <span>{getSecondaryLine(transaction, category)}</span>
                  </td>
                  {!isLanded && <td>{transaction.unit_type || '—'}</td>}
                  <td>{transaction.floor_area_sqft ? `${transaction.floor_area_sqft.toLocaleString()} sqft` : '—'}</td>
                  <td>{transaction.floor_level || '—'}</td>
                  <td><strong>{formatCurrency(transaction.transaction_price)}</strong></td>
                  <td>{transaction.price_psf ? `$${transaction.price_psf.toLocaleString()} psf` : '—'}</td>
                  <td>{formatDistance(transaction.distance_m)}</td>
                </tr>
              )) : (
                <tr><td colSpan={isLanded ? 7 : 8}>No recent transactions saved for this report.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </section>

      <section className="page page-two">
        <section className="section">
          <div className="section-title">3. Current Competing Listings</div>
          <div className="listing-grid">
            {[0, 1, 2].map((index) => {
              const listing = listings[index] || {}
              const asking = listing.asking_price ? formatCurrency(listing.asking_price) : '—'
              const size = listing.size_sqft ? `${Number(listing.size_sqft).toLocaleString()} sqft` : '—'
              const psf = listing.psf || (toNumber(listing.asking_price) && toNumber(listing.size_sqft) ? `$${Math.round((toNumber(listing.asking_price) || 0) / (toNumber(listing.size_sqft) || 1)).toLocaleString()} psf` : '—')
              return (
                <div className="listing-card" key={index}>
                  <div className="listing-number">Listing {index + 1}</div>
                  <strong>{listing.title || '—'}</strong>
                  <div className="listing-meta">
                    <span>{asking}</span><span>{size}</span><span>{psf}</span>
                  </div>
                  <p>{listing.condition || 'Condition not stated'} · {listing.source || 'Source not stated'}</p>
                  <p>{listing.notes || '—'}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="section market-range-section">
          <div className="section-title">4. Estimated Market Range</div>
          <p className="section-subtitle">Renovated is based on the HomeValue estimate. Original is 8% below. Well-renovated is 8% above.</p>
          <div className="range-grid">
            <div className="range-card"><span>Original</span><strong>{rangeText(report.original_low, report.original_high)}</strong></div>
            <div className="range-card highlighted"><span>Renovated</span><strong>{rangeText(report.renovated_low, report.renovated_high)}</strong></div>
            <div className="range-card"><span>Well-renovated</span><strong>{rangeText(report.well_renovated_low, report.well_renovated_high)}</strong></div>
          </div>
          {report.suggested_asking_price && <div className="suggested-price">Suggested asking price: <strong>{formatCurrency(report.suggested_asking_price)}</strong></div>}
        </section>

        <section className="section notes-section">
          <div className="section-title">5. NexDoor Consultant Notes</div>
          <div className="notes-box">{report.consultant_notes || '—'}</div>
        </section>

        <footer className="footer-note">
          This report is prepared for discussion purposes only and is not a formal valuation. Final pricing should consider unit condition, renovation, facing, live competing listings, buyer demand, and changes in market conditions.
        </footer>
      </section>

      <style jsx global>{`
        * { box-sizing: border-box; }
        body { margin: 0; background: #f5efe6; color: #221915; font-family: Arial, Helvetica, sans-serif; }
        .screen-shell { min-height: 100vh; display: grid; place-items: center; padding: 40px; }
        .loading-card { background: #fffaf3; border: 1px solid #ddc7ad; border-radius: 18px; padding: 28px; }
        .print-shell { padding: 24px 0 48px; }
        .toolbar { width: 794px; margin: 0 auto 16px; display: flex; justify-content: space-between; gap: 12px; }
        .toolbar a, .toolbar button { border: 1px solid #c9a889; background: #fffaf3; border-radius: 999px; color: #221915; padding: 10px 16px; font-weight: 700; text-decoration: none; cursor: pointer; }
        .toolbar button { background: #221915; color: #fffaf3; }
        .page { width: 794px; min-height: 1123px; margin: 0 auto 24px; background: #fffaf7; border: 1px solid #ddc7ad; box-shadow: 0 8px 24px rgba(50, 30, 10, 0.12); padding: 28px; page-break-after: always; overflow: hidden; }
        .page-two { page-break-after: auto; }
        .report-header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #eadbc9; padding-bottom: 18px; margin-bottom: 18px; }
        .eyebrow { color: #b97935; text-transform: uppercase; font-size: 9px; font-weight: 800; letter-spacing: 1.8px; }
        h1 { margin: 4px 0 4px; font-size: 24px; line-height: 1.05; }
        .report-header p { margin: 0; color: #735f50; font-size: 12px; }
        .header-meta { display: grid; grid-template-columns: 1fr; gap: 8px; min-width: 190px; text-align: right; }
        .header-meta span { display: block; color: #8a7361; text-transform: uppercase; font-size: 8px; letter-spacing: 1.2px; font-weight: 800; }
        .header-meta strong { font-size: 12px; }
        .section { margin-top: 14px; }
        .section-title { font-size: 15px; font-weight: 800; margin-bottom: 8px; }
        .section-subtitle { margin: -4px 0 10px; color: #705d4e; font-size: 10px; }
        .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
        .info-item { border: 1px solid #e4cdb5; border-radius: 10px; padding: 8px 10px; min-height: 44px; background: #fffdf9; }
        .label { color: #836b58; text-transform: uppercase; font-size: 7.5px; letter-spacing: 1.2px; font-weight: 800; margin-bottom: 3px; }
        .value { font-size: 11px; font-weight: 700; line-height: 1.25; }
        table.transactions { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e3cdb7; border-radius: 12px; overflow: hidden; font-size: 9px; table-layout: fixed; }
        .transactions th { background: #f8f0e6; color: #806854; text-transform: uppercase; letter-spacing: 1.2px; font-size: 7.5px; text-align: left; padding: 8px 8px; }
        .transactions td { border-top: 1px solid #ecdccc; padding: 7px 8px; vertical-align: top; color: #5a493d; }
        .transactions strong { color: #241a15; }
        .transactions td span { display: block; color: #7c6756; font-size: 8px; margin-top: 3px; }
        .transactions th:nth-child(1), .transactions td:nth-child(1) { width: 10%; }
        .transactions th:nth-child(2), .transactions td:nth-child(2) { width: 24%; }
        .transactions th:nth-child(3), .transactions td:nth-child(3) { width: 18%; }
        .transactions th:nth-child(4), .transactions td:nth-child(4) { width: 11%; }
        .transactions th:nth-child(5), .transactions td:nth-child(5) { width: 11%; }
        .transactions th:nth-child(6), .transactions td:nth-child(6) { width: 12%; }
        .transactions th:nth-child(7), .transactions td:nth-child(7) { width: 10%; }
        .transactions th:nth-child(8), .transactions td:nth-child(8) { width: 8%; }
        .landed-table th:nth-child(2), .landed-table td:nth-child(2) { width: 34%; }
        .listing-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
        .listing-card { border: 1px solid #e3cdb7; border-radius: 12px; padding: 10px 12px; background: #fffdf9; }
        .listing-number { color: #b97935; font-size: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.2px; margin-bottom: 4px; }
        .listing-card strong { font-size: 12px; }
        .listing-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0; font-size: 10px; font-weight: 800; }
        .listing-card p { margin: 4px 0 0; font-size: 9px; color: #705d4e; line-height: 1.35; }
        .range-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        .range-card { border: 1px solid #e1c6ac; border-radius: 14px; padding: 14px; background: #fffdf9; }
        .range-card.highlighted { background: #fff4e4; border-color: #c88b4c; }
        .range-card span { display: block; color: #b97935; text-transform: uppercase; letter-spacing: 1.2px; font-size: 8px; font-weight: 900; margin-bottom: 6px; }
        .range-card strong { font-size: 14px; line-height: 1.2; }
        .suggested-price { margin-top: 10px; border: 1px dashed #d2b598; border-radius: 12px; padding: 10px 12px; font-size: 11px; }
        .notes-box { min-height: 110px; border: 1px solid #e3cdb7; border-radius: 12px; padding: 12px; font-size: 11px; color: #5b493b; line-height: 1.45; white-space: pre-wrap; background: #fffdf9; }
        .footer-note { position: absolute; bottom: 24px; left: 28px; right: 28px; border-top: 1px solid #eadbc9; padding-top: 10px; color: #806854; font-size: 8px; line-height: 1.35; }
        .page-two { position: relative; padding-bottom: 70px; }
        @page { size: A4 portrait; margin: 0; }
        @media print {
          body { background: white; }
          .no-print { display: none !important; }
          .print-shell { padding: 0; }
          .page { width: 210mm; min-height: 297mm; margin: 0; border: none; box-shadow: none; border-radius: 0; page-break-after: always; }
          .page-two { page-break-after: auto; }
        }
      `}</style>
    </main>
  )
}

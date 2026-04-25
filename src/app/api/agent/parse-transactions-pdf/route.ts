import { createRequire } from 'module'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const requirePdfParse = createRequire(import.meta.url)

type ParsedTransaction = {
  id: string
  transaction_date: string
  display_name: string
  project_name: string
  address: string
  unit_type: string
  floor_area_sqft: number
  floor_level: string
  transaction_price: number
  price_psf: number
  distance_m: number
}

function normaliseText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function parseMoney(value: string | null | undefined) {
  if (!value) return 0

  const cleaned = value.replace(/[$,\s]/g, '').toUpperCase()
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)(M|K)?$/)
  if (!match) return 0

  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return 0

  if (match[2] === 'M') return Math.round(amount * 1_000_000)
  if (match[2] === 'K') return Math.round(amount * 1_000)
  return Math.round(amount)
}

function parsePsf(value: string | null | undefined) {
  if (!value) return 0
  const match = value.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*PSF/i)
  if (!match) return 0
  const numberValue = Number(match[1])
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0
}

function parseDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (!match) return ''

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return ''

  return `20${String(year).padStart(2, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function getTransactionTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function extractFloorFromAddress(value: string) {
  const match = value.match(/#\s*(\d{1,2})\s*[-A-Z0-9]/i)
  if (!match) return ''
  const level = Number(match[1])
  if (!Number.isFinite(level)) return ''
  return `Level ${level}`
}

function cleanLine(line: string) {
  return normaliseText(line)
    .replace(/^https:\/\/tech-rea\.com\/realAgent\s*/i, '')
    .replace(/^Generated on:.*$/i, '')
    .trim()
}

function isNoiseLine(line: string) {
  const text = line.toLowerCase()
  if (!text) return true
  if (text.includes('transaction list')) return true
  if (text.includes('calculate your home')) return true
  if (text.includes('generated on:')) return true
  if (text.includes('lim dong xian')) return true
  if (text.includes('agency:')) return true
  if (text.includes('cea:')) return true
  if (text.includes('built-up / floor area')) return true
  if (text.includes('date details transacted')) return true
  if (text.includes('source & activity')) return true
  if (text.includes('previous activity')) return true
  if (text.includes('gain/loss')) return true
  return false
}

function parseRealAgentTransactions(rawText: string) {
  const normalised = rawText
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')

  const rowPattern = /(\d{2}\/\d{2}\/\d{2})\s+([\s\S]*?)(?=\n\d{2}\/\d{2}\/\d{2}\s+|\nTransaction List|$)/g
  const rows: ParsedTransaction[] = []
  let match: RegExpExecArray | null
  let index = 0

  while ((match = rowPattern.exec(normalised)) !== null) {
    const dateText = match[1]
    const blockText = match[2]

    const lines = blockText
      .split('\n')
      .map(cleanLine)
      .filter((line) => !isNoiseLine(line))

    if (lines.length < 5) continue

    const projectName = lines[0]
    const address = lines[1]
    const sizeLineIndex = lines.findIndex((line, lineIndex) => lineIndex >= 2 && /\b\d[\d,]*(?:\.\d+)?\s*sqft\b/i.test(line))
    if (sizeLineIndex === -1) continue

    const sizeLine = lines[sizeLineIndex]
    const sizeMatch = sizeLine.replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\s*sqft\b/i)
    const floorAreaSqft = sizeMatch ? Math.round(Number(sizeMatch[1])) : 0

    const unitTypeLine = lines[sizeLineIndex + 1] || ''
    const amountLine = lines.find((line, lineIndex) => lineIndex > sizeLineIndex && /^\$\s*-?\d/i.test(line) && !/PSF/i.test(line)) || ''
    const psfLine = lines.find((line, lineIndex) => lineIndex > sizeLineIndex && /PSF/i.test(line)) || ''

    const transactionDate = parseDate(dateText)
    const transactionPrice = parseMoney(amountLine)
    const pricePsf = parsePsf(psfLine)

    if (!transactionDate || !projectName || !address || !floorAreaSqft || !transactionPrice || !pricePsf) continue

    rows.push({
      id: `uploaded-pdf-${index + 1}`,
      transaction_date: transactionDate,
      display_name: address,
      project_name: projectName,
      address,
      unit_type: unitTypeLine,
      floor_area_sqft: floorAreaSqft,
      floor_level: extractFloorFromAddress(address),
      transaction_price: transactionPrice,
      price_psf: pricePsf,
      distance_m: -1,
    })

    index += 1
  }

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  twelveMonthsAgo.setHours(0, 0, 0, 0)

  return rows
    .filter((row) => {
      const timestamp = getTransactionTimestamp(row.transaction_date)
      return timestamp > 0 && timestamp >= twelveMonthsAgo.getTime()
    })
    .sort((a, b) => getTransactionTimestamp(b.transaction_date) - getTransactionTimestamp(a.transaction_date))
    .slice(0, 15)
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Please upload a PDF file.' }, { status: 400 })
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Please upload a PDF file.' }, { status: 400 })
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF is too large. Please upload a file below 8MB.' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const pdfParse = requirePdfParse('pdf-parse') as (input: Buffer) => Promise<{ text?: string }>
    const parsed = await pdfParse(buffer)
    const transactions = parseRealAgentTransactions(parsed.text || '')

    if (transactions.length === 0) {
      return NextResponse.json({ error: 'No usable transactions were found in this PDF.' }, { status: 422 })
    }

    return NextResponse.json({ transactions })
  } catch (error) {
    console.error('PDF transaction parser error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to parse this PDF.' },
      { status: 500 }
    )
  }
}

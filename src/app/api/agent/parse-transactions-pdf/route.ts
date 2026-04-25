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
  return (value || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim()
}

function parseMoney(value: string | null | undefined) {
  if (!value) return 0
  const moneyMatch = value.match(/\$\s*-?\d[\d,]*(?:\.\d+)?\s*(?:M|K)?/i)
  if (!moneyMatch) return 0

  const cleaned = moneyMatch[0].replace(/[$,\s]/g, '').toUpperCase()
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
  const match = value.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*P\s*S\s*F/i)
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

function titleCaseFallback(value: string) {
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^#/.test(word)) return word.toUpperCase()
      if (/^\d+[a-z]?$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function removeMoneyAndPsf(value: string) {
  return normaliseText(value)
    .replace(/\$\s*-?\d[\d,]*(?:\.\d+)?\s*(?:M|K)?/gi, ' ')
    .replace(/\$?\s*\d[\d,]*(?:\.\d+)?\s*P\s*S\s*F/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNoiseText(value: string) {
  const text = value.toLowerCase().trim()
  if (!text) return true
  if (text.includes('https://tech-rea.com/realagent')) return true
  if (text.includes('generated on:')) return true
  if (text.includes('transaction list')) return true
  if (text.includes('calculate your home')) return true
  if (text.includes('lim dong xian')) return true
  if (text.includes('agency:')) return true
  if (text.includes('cea:')) return true
  if (text.includes('built-up / floor area')) return true
  if (text.includes('values represented')) return true
  if (text.includes('date details')) return true
  if (text.includes('transacted amount')) return true
  if (text.includes('source & activity')) return true
  if (text.includes('previous activity')) return true
  if (text.includes('gain/loss')) return true
  if (/^\d+\s+of\s+\d+$/i.test(text)) return true
  return false
}

function cleanPdfText(rawText: string) {
  const text = rawText
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\f\v]+/g, '\n')

  return text
    .replace(new RegExp('([^\\n])(\\d{2}\\/\\d{2}\\/\\d{2})\\b', 'g'), '$1\n$2')
    .replace(/\b(\d{2}\/\d{2}\/\d{2})(?=\S)/g, '$1 ')
}

function getRowBlocks(rawText: string) {
  const text = cleanPdfText(rawText)
  const rowPattern = /(^|\n)\s*(\d{2}\/\d{2}\/\d{2})\s+([\s\S]*?)(?=\n\s*\d{2}\/\d{2}\/\d{2}\s+|\n\s*Transaction List|$)/g
  const blocks: { dateText: string; body: string }[] = []
  let match: RegExpExecArray | null

  while ((match = rowPattern.exec(text)) !== null) {
    const body = normaliseText(match[3])
    if (!body || isNoiseText(body)) continue
    blocks.push({ dateText: match[2], body })
  }

  return blocks
}

function extractProjectAddressFromLines(body: string) {
  const rawLines = body
    .split('\n')
    .map((line) => removeMoneyAndPsf(line))
    .map((line) => line.replace(/^N\.A\b.*$/i, '').trim())
    .filter((line) => line && !isNoiseText(line))

  const meaningfulLines = rawLines.filter((line) => {
    if (/^N\.A$/i.test(line)) return false
    if (/^(URA|Agency|Resale|Sub Sale|New Launch)$/i.test(line)) return false
    if (/^\$/.test(line)) return false
    if (/^\d{2}\/\d{2}\/\d{2}$/.test(line)) return false
    if (/^-?\d+%$/.test(line)) return false
    if (/^\d+\s+months$/i.test(line)) return false
    return true
  })

  const sizeIndex = meaningfulLines.findIndex((line) => /\b\d[\d,]*(?:\.\d+)?\s*sqft\b/i.test(line))
  const beforeSize = sizeIndex >= 0 ? meaningfulLines.slice(0, sizeIndex) : meaningfulLines.slice(0, 2)

  if (beforeSize.length >= 2) {
    return {
      projectName: beforeSize[0],
      address: beforeSize[1],
    }
  }

  return { projectName: '', address: '' }
}

function extractProjectAddressFromFlatBody(body: string) {
  const cleaned = removeMoneyAndPsf(body)
    .replace(/\bN\.A\b.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const sizeIndex = cleaned.search(/\b\d[\d,]*(?:\.\d+)?\s*sqft\b/i)
  const beforeSize = sizeIndex >= 0 ? cleaned.slice(0, sizeIndex).trim() : cleaned

  const addressWithUnit = beforeSize.match(/(.+?)\s+(\d+[A-Za-z]?\s+[^#\n]+?#\s*\d{1,3}\s*[-A-Za-z0-9]+)\s*$/i)
  if (addressWithUnit) {
    return {
      projectName: addressWithUnit[1].trim(),
      address: addressWithUnit[2].replace(/#\s+/g, '#').trim(),
    }
  }

  const addressWithoutUnit = beforeSize.match(/(.+?)\s+(\d+[A-Za-z]?\s+.+)$/i)
  if (addressWithoutUnit) {
    return {
      projectName: addressWithoutUnit[1].trim(),
      address: addressWithoutUnit[2].trim(),
    }
  }

  return { projectName: '', address: '' }
}

function extractSize(body: string) {
  const match = body.replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\s*sqft\b/i)
  const numberValue = match ? Number(match[1]) : 0
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0
}

function extractUnitType(body: string) {
  const text = body.replace(/\n/g, ' ')
  const match = text.match(/\b(Apartment|Condominium|Executive Condominium)(?:\s*[•·]\s*\d+\s*bed)?(?:\s*[•·]\s*\d+\s*bath)?/i)
  if (!match) return ''
  return match[0].replace(/\s+/g, ' ').trim()
}

function parseRealAgentTransactions(rawText: string) {
  const rowBlocks = getRowBlocks(rawText)
  const rows: ParsedTransaction[] = []

  rowBlocks.forEach((rowBlock, index) => {
    const transactionDate = parseDate(rowBlock.dateText)
    if (!transactionDate) return

    const body = rowBlock.body
    const transactionPrice = parseMoney(body)
    const pricePsf = parsePsf(body)
    const floorAreaSqft = extractSize(body)

    if (!transactionPrice || !pricePsf || !floorAreaSqft) return

    const fromLines = extractProjectAddressFromLines(body)
    const fromFlatBody = extractProjectAddressFromFlatBody(body)
    const projectName = normaliseText(fromLines.projectName || fromFlatBody.projectName)
    const address = normaliseText(fromLines.address || fromFlatBody.address)

    if (!projectName || !address) return

    rows.push({
      id: `uploaded-pdf-${index + 1}`,
      transaction_date: transactionDate,
      display_name: titleCaseFallback(address),
      project_name: titleCaseFallback(projectName),
      address: titleCaseFallback(address),
      unit_type: extractUnitType(body),
      floor_area_sqft: floorAreaSqft,
      floor_level: extractFloorFromAddress(address),
      transaction_price: transactionPrice,
      price_psf: pricePsf,
      distance_m: -1,
    })
  })

  const seen = new Set<string>()
  const deduped = rows.filter((row) => {
    const key = [row.transaction_date, row.address.toUpperCase(), row.floor_area_sqft, row.transaction_price].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  twelveMonthsAgo.setHours(0, 0, 0, 0)

  return deduped
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
      return NextResponse.json(
        {
          error: 'No usable transactions were found in this PDF.',
          debug: {
            textLength: parsed.text?.length || 0,
            textPreview: (parsed.text || '').slice(0, 1200),
            rowBlocksFound: getRowBlocks(parsed.text || '').length,
          },
        },
        { status: 422 }
      )
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

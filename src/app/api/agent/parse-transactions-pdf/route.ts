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

  const moneyMatch = value.match(/\$\s*-?\d[\d,.]*(?:\.\d+)?\s*(?:M|K)?/i)
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

function removeMoneyAndPsf(value: string) {
  return normaliseText(value)
    .replace(/\$\s*-?\d[\d,.]*(?:\.\d+)?\s*(?:M|K)?/gi, ' ')
    .replace(/\$?\s*\d[\d,.]*(?:\.\d+)?\s*PSF/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanLine(line: string) {
  return normaliseText(line)
    .replace(/^https:\/\/tech-rea\.com\/realAgent\s*/i, '')
    .replace(/^Generated on:.*$/i, '')
    .replace(/[\f\u0000-\u001f]+/g, ' ')
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
  if (text.includes('date details')) return true
  if (text.includes('transacted amount')) return true
  if (text.includes('source & activity')) return true
  if (text.includes('previous activity')) return true
  if (text.includes('gain/loss')) return true
  if (/^\d+\s+of\s+\d+$/i.test(text)) return true
  return false
}

function looksLikeUnitType(line: string) {
  const text = line.toUpperCase()
  return (
    text.includes('APARTMENT') ||
    text.includes('CONDOMINIUM') ||
    text.includes('EXECUTIVE CONDOMINIUM') ||
    text.includes('TERRACE') ||
    text.includes('SEMI-DETACHED') ||
    text.includes('SEMI DETACHED') ||
    text.includes('DETACHED') ||
    text.includes('BUNGALOW') ||
    text.includes('ROOM') ||
    text.includes('BED') ||
    text.includes('BATH')
  )
}

function looksLikeNonTransactionDetail(line: string) {
  const text = removeMoneyAndPsf(line).toUpperCase().trim()
  if (!text) return true
  if (text === 'N.A') return true
  if (text === 'URA') return true
  if (text === 'AGENCY') return true
  if (text === 'RESALE') return true
  if (text === 'SUB SALE') return true
  if (text === 'NEW LAUNCH') return true
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(text)) return true
  if (/^-?\d+%$/.test(text)) return true
  if (/^\d+\s+MONTHS$/i.test(text)) return true
  return false
}

function getCandidateLines(rawText: string) {
  return rawText
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(cleanLine)
    .filter((line) => !isNoiseLine(line))
}

function splitRowsFromLines(lines: string[]) {
  const rowBlocks: { dateText: string; lines: string[] }[] = []
  let current: { dateText: string; lines: string[] } | null = null

  for (const originalLine of lines) {
    const line = originalLine.replace(/^[^0-9]*(?=\d{2}\/\d{2}\/\d{2})/, '').trim()
    const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{2})(?:\s+(.*))?$/)

    if (dateMatch) {
      if (current) rowBlocks.push(current)
      current = {
        dateText: dateMatch[1],
        lines: dateMatch[2] ? [dateMatch[2]] : [],
      }
      continue
    }

    if (current) current.lines.push(line)
  }

  if (current) rowBlocks.push(current)
  return rowBlocks
}

function parseRowsFromLineBlocks(rawText: string) {
  const rowBlocks = splitRowsFromLines(getCandidateLines(rawText))
  const rows: ParsedTransaction[] = []

  rowBlocks.forEach((rowBlock, index) => {
    const transactionDate = parseDate(rowBlock.dateText)
    if (!transactionDate) return

    const lines = rowBlock.lines.map(cleanLine).filter((line) => !isNoiseLine(line))
    if (lines.length < 3) return

    const joinedBlock = lines.join('\n')
    const transactionPrice = parseMoney(joinedBlock)
    const pricePsf = parsePsf(joinedBlock)
    if (!transactionPrice || !pricePsf) return

    const projectLineIndex = lines.findIndex((line) => {
      const cleaned = removeMoneyAndPsf(line)
      return Boolean(cleaned && !/\bsqft\b/i.test(cleaned) && !looksLikeNonTransactionDetail(cleaned))
    })
    if (projectLineIndex === -1) return

    const projectName = removeMoneyAndPsf(lines[projectLineIndex])
    if (!projectName) return

    const addressLineIndex = lines.findIndex((line, lineIndex) => {
      if (lineIndex <= projectLineIndex) return false
      const cleaned = removeMoneyAndPsf(line)
      if (!cleaned || /\bsqft\b/i.test(cleaned) || looksLikeNonTransactionDetail(cleaned)) return false
      if (looksLikeUnitType(cleaned)) return false
      return true
    })
    if (addressLineIndex === -1) return

    const address = removeMoneyAndPsf(lines[addressLineIndex])
    if (!address) return

    const sizeLineIndex = lines.findIndex((line, lineIndex) => {
      if (lineIndex <= addressLineIndex) return false
      return /\b\d[\d,]*(?:\.\d+)?\s*sqft\b/i.test(line)
    })
    if (sizeLineIndex === -1) return

    const sizeMatch = lines[sizeLineIndex].replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\s*sqft\b/i)
    const floorAreaSqft = sizeMatch ? Math.round(Number(sizeMatch[1])) : 0
    if (!floorAreaSqft) return

    const unitTypeLine =
      lines.find((line, lineIndex) => {
        if (lineIndex <= sizeLineIndex) return false
        if (!looksLikeUnitType(line)) return false
        if (/\$/.test(line) || /PSF/i.test(line) || looksLikeNonTransactionDetail(line)) return false
        return true
      }) || ''

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
  })

  return rows
}

function parseRowsFromFlatText(rawText: string) {
  const text = rawText
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')

  const rowPattern = /(\d{2}\/\d{2}\/\d{2})\s+([\s\S]*?)(?=\s+\d{2}\/\d{2}\/\d{2}\s+|\s+Transaction List|$)/g
  const rows: ParsedTransaction[] = []
  let match: RegExpExecArray | null
  let index = 0

  while ((match = rowPattern.exec(text)) !== null) {
    const transactionDate = parseDate(match[1])
    if (!transactionDate) continue

    const block = normaliseText(match[2])
    const transactionPrice = parseMoney(block)
    const pricePsf = parsePsf(block)
    const sizeMatch = block.replace(/,/g, '').match(/\b(\d+(?:\.\d+)?)\s*sqft\b/i)
    const floorAreaSqft = sizeMatch ? Math.round(Number(sizeMatch[1])) : 0

    if (!transactionPrice || !pricePsf || !floorAreaSqft) continue

    const priceIndex = block.search(/\$\s*-?\d[\d,.]*(?:\.\d+)?\s*(?:M|K)?/i)
    const beforePrice = priceIndex >= 0 ? block.slice(0, priceIndex).trim() : block
    const parts = beforePrice.split(/\s{2,}|(?=\d+\s+[A-Z][A-Za-z]+\s+#?\d)/).map((part) => part.trim()).filter(Boolean)

    let projectName = ''
    let address = ''

    if (parts.length >= 2) {
      projectName = removeMoneyAndPsf(parts[0])
      address = removeMoneyAndPsf(parts[1])
    }

    if (!projectName || !address) {
      const simpleMatch = beforePrice.match(/^(.+?)\s+((?:\d+[A-Za-z]?\s+).+?#?[A-Za-z0-9-]+)$/)
      if (simpleMatch) {
        projectName = removeMoneyAndPsf(simpleMatch[1])
        address = removeMoneyAndPsf(simpleMatch[2])
      }
    }

    if (!projectName || !address) continue

    const unitTypeMatch = block.match(/(Apartment|Condominium|Executive Condominium)(?:\s*•\s*[^$\n]+)?/i)
    const unitTypeLine = unitTypeMatch ? normaliseText(unitTypeMatch[0]) : ''

    rows.push({
      id: `uploaded-pdf-flat-${index + 1}`,
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

  return rows
}

function dedupeRows(rows: ParsedTransaction[]) {
  const seen = new Set<string>()
  const output: ParsedTransaction[] = []

  for (const row of rows) {
    const key = [row.transaction_date, row.address, row.floor_area_sqft, row.transaction_price].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(row)
  }

  return output
}

function parseRealAgentTransactions(rawText: string) {
  const parsedRows = dedupeRows([
    ...parseRowsFromLineBlocks(rawText),
    ...parseRowsFromFlatText(rawText),
  ])

  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  twelveMonthsAgo.setHours(0, 0, 0, 0)

  return parsedRows
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

'use client'

import { useEffect } from 'react'

const TARGET_PATHS = new Set(['/', '/free-property-valuation-singapore'])
const SQFT_PER_SQM = 10.7639

type AreaUnit = 'sqft' | 'sqm'
type AreaFieldKind = 'floor' | 'land' | 'builtUp'

type ManagedAreaField = {
  input: HTMLInputElement
  unitSelect: HTMLSelectElement
  warning: HTMLDivElement
  kind: AreaFieldKind
}

function normaliseText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function getAreaFieldKind(input: HTMLInputElement): AreaFieldKind | null {
  const text = normaliseText([
    input.getAttribute('aria-label'),
    input.getAttribute('placeholder'),
    input.previousElementSibling?.textContent,
    input.parentElement?.textContent,
    input.closest('label')?.textContent,
    input.closest('div')?.textContent,
  ].filter(Boolean).join(' '))

  if (text.includes('built-up') || text.includes('built up')) return 'builtUp'
  if (text.includes('land size')) return 'land'
  if (text.includes('floor area')) return 'floor'
  return null
}

function isGenerateButton(button: HTMLButtonElement) {
  const text = normaliseText(button.textContent)
  if (text.includes('unlock') || text.includes('maybe later')) return false
  return text.includes('home value') || text.includes('property value') || text.includes('generate') || text.includes('calculate') || text.includes('estimate')
}

function setNativeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function convertSqmToSqft(value: string) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null
  return (numberValue * SQFT_PER_SQM).toFixed(2)
}

function shouldWarn(input: HTMLInputElement, unit: AreaUnit) {
  const numberValue = Number(input.value)
  return unit === 'sqft' && Number.isFinite(numberValue) && numberValue >= 20 && numberValue <= 200
}

function updateWarning(field: ManagedAreaField) {
  if (!shouldWarn(field.input, field.unitSelect.value as AreaUnit)) {
    field.warning.style.display = 'none'
    field.warning.textContent = ''
    return
  }

  const sqftValue = convertSqmToSqft(field.input.value)
  const approx = sqftValue ? Math.round(Number(sqftValue)).toLocaleString('en-SG') : ''
  const label = field.kind === 'land' ? 'land size' : field.kind === 'builtUp' ? 'built-up size' : 'floor area'

  field.warning.style.display = 'block'
  field.warning.textContent = `This ${label} looks unusually small. Did you mean ${field.input.value} sqm${approx ? `, about ${approx} sqft` : ''}? Change the unit to sqm if that is correct.`
}

function attachUnitSelector(input: HTMLInputElement, kind: AreaFieldKind): ManagedAreaField | null {
  if (input.dataset.homevalueAreaUnitAttached === 'true') return null
  if (input.type && !['text', 'number', 'tel'].includes(input.type)) return null

  input.dataset.homevalueAreaUnitAttached = 'true'

  const row = document.createElement('div')
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.justifyContent = 'space-between'
  row.style.gap = '10px'
  row.style.marginTop = '8px'
  row.style.fontSize = '12px'
  row.style.color = '#5f666d'

  const helper = document.createElement('span')
  helper.textContent = 'Enter your size in sqft or sqm. We will convert it automatically.'
  helper.style.lineHeight = '1.4'

  const select = document.createElement('select')
  select.value = 'sqft'
  select.setAttribute('aria-label', 'Area unit')
  select.style.border = '1px solid #ead7c6'
  select.style.borderRadius = '999px'
  select.style.background = '#fffaf5'
  select.style.color = '#2d3135'
  select.style.fontWeight = '700'
  select.style.padding = '6px 10px'

  select.innerHTML = '<option value="sqft">sqft</option><option value="sqm">sqm</option>'

  row.appendChild(helper)
  row.appendChild(select)

  const warning = document.createElement('div')
  warning.style.display = 'none'
  warning.style.marginTop = '8px'
  warning.style.border = '1px solid #f5c4b3'
  warning.style.borderRadius = '14px'
  warning.style.background = '#fff3f0'
  warning.style.color = '#9a3412'
  warning.style.fontSize = '12px'
  warning.style.lineHeight = '1.5'
  warning.style.padding = '10px 12px'

  input.insertAdjacentElement('afterend', row)
  row.insertAdjacentElement('afterend', warning)

  const field: ManagedAreaField = { input, unitSelect: select, warning, kind }
  input.addEventListener('input', () => updateWarning(field))
  select.addEventListener('change', () => updateWarning(field))
  updateWarning(field)
  return field
}

export default function HomeValueAreaUnitSelector() {
  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
    if (!TARGET_PATHS.has(currentPath)) return

    const managedFields = new Set<ManagedAreaField>()
    let replayingClick = false

    const scan = () => {
      Array.from(document.querySelectorAll('input')).forEach((element) => {
        const input = element as HTMLInputElement
        const kind = getAreaFieldKind(input)
        if (!kind) return
        const field = attachUnitSelector(input, kind)
        if (field) managedFields.add(field)
      })
    }

    const convertSelectedSqmFields = () => {
      let didConvert = false
      managedFields.forEach((field) => {
        if (!document.body.contains(field.input) || field.unitSelect.value !== 'sqm') return
        const sqftValue = convertSqmToSqft(field.input.value)
        if (!sqftValue) return
        setNativeInputValue(field.input, sqftValue)
        field.unitSelect.value = 'sqft'
        updateWarning(field)
        didConvert = true
      })
      return didConvert
    }

    const handleGenerateClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null
      if (!button || !isGenerateButton(button) || replayingClick) return
      const didConvert = convertSelectedSqmFields()
      if (!didConvert) return
      event.preventDefault()
      event.stopPropagation()
      replayingClick = true
      window.setTimeout(() => {
        button.click()
        replayingClick = false
      }, 0)
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('click', handleGenerateClick, true)

    return () => {
      observer.disconnect()
      document.removeEventListener('click', handleGenerateClick, true)
    }
  }, [])

  return null
}

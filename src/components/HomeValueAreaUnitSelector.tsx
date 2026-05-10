'use client'

import { useEffect } from 'react'

const TARGET_PATHS = new Set(['/', '/free-property-valuation-singapore'])
const SQFT_PER_SQM = 10.7639
const ROW_ATTR = 'data-homevalue-area-unit-row'
const ATTACHED_ATTR = 'data-homevalue-area-unit-attached'

type AreaUnit = 'sqft' | 'sqm'
type AreaFieldKind = 'floor' | 'land' | 'builtUp'

type ManagedAreaField = {
  input: HTMLInputElement
  row: HTMLDivElement
  select: HTMLSelectElement
  warning: HTMLDivElement
  kind: AreaFieldKind
}

function normaliseText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
}

function findFieldWrapper(input: HTMLInputElement) {
  return input.closest('label') as HTMLElement | null || input.parentElement
}

function isUsableInput(input: HTMLInputElement) {
  if (!document.body.contains(input)) return false
  if (input.disabled) return false
  if (input.type && !['text', 'number', 'tel'].includes(input.type)) return false
  if (!isVisible(input)) return false

  const wrapper = findFieldWrapper(input)
  if (wrapper && !isVisible(wrapper)) return false

  return true
}

function getAssociatedText(input: HTMLInputElement) {
  const id = input.id
  const labelByFor = id
    ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
    : ''

  const labelText = input.closest('label')?.textContent || ''
  const previousText = input.previousElementSibling?.textContent || ''
  const parentText = input.parentElement?.textContent || ''
  const ariaLabel = input.getAttribute('aria-label') || ''
  const name = input.getAttribute('name') || ''
  const placeholder = input.getAttribute('placeholder') || ''

  return normaliseText(
    [labelByFor, labelText, previousText, parentText, ariaLabel, name, placeholder]
      .filter(Boolean)
      .join(' ')
  )
}

function getAreaFieldKind(input: HTMLInputElement): AreaFieldKind | null {
  if (!isUsableInput(input)) return null

  const text = getAssociatedText(input)

  if (!text) return null
  if (text.includes('property type')) return null
  if (text.includes('floor level')) return null
  if (text.includes('stack number')) return null
  if (text.includes('tenure')) return null
  if (text.includes('address')) return null
  if (text.includes('postal')) return null
  if (text.includes('unit number')) return null

  if (text.includes('built-up') || text.includes('built up')) return 'builtUp'
  if (text.includes('land size')) return 'land'
  if (text.includes('floor area')) return 'floor'

  return null
}

function getPlaceholder(kind: AreaFieldKind, unit: AreaUnit) {
  if (unit === 'sqm') {
    if (kind === 'land') return 'e.g. 250'
    if (kind === 'builtUp') return 'e.g. 420'
    return 'e.g. 92'
  }

  if (kind === 'land') return 'e.g. 2700'
  if (kind === 'builtUp') return 'e.g. 4500'
  return 'e.g. 990'
}

function shouldWarn(input: HTMLInputElement, unit: AreaUnit) {
  const value = Number(input.value)
  return unit === 'sqft' && Number.isFinite(value) && value >= 20 && value <= 200
}

function updateFieldUi(field: ManagedAreaField) {
  const unit = field.select.value as AreaUnit
  field.input.placeholder = getPlaceholder(field.kind, unit)

  if (!shouldWarn(field.input, unit)) {
    field.warning.hidden = true
    field.warning.textContent = ''
    return
  }

  const label = field.kind === 'land' ? 'land size' : field.kind === 'builtUp' ? 'built-up size' : 'floor area'
  field.warning.hidden = false
  field.warning.textContent = `This ${label} looks small for sqft. If your size is in sqm, change the unit to sqm.`
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

function cleanAreaLabelText() {
  const elements = Array.from(document.querySelectorAll('label, p, span, div')) as HTMLElement[]

  elements.forEach((element) => {
    if (element.children.length > 0) return
    const text = element.textContent || ''
    const cleaned = text
      .replace(/floor area\s*\(sqft\)/i, 'Floor Area')
      .replace(/land size\s*\(sqft\)/i, 'Land Size')
      .replace(/built-up size\s*\(sqft\)/i, 'Built-up Size')
      .replace(/built up size\s*\(sqft\)/i, 'Built-up Size')

    if (cleaned !== text) element.textContent = cleaned
  })
}

function injectStyles() {
  if (document.getElementById('homevalue-safe-area-unit-styles')) return

  const style = document.createElement('style')
  style.id = 'homevalue-safe-area-unit-styles'
  style.textContent = `
    [${ROW_ATTR}] {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      margin-top: 10px;
      color: #5f666d;
      font-size: 12px;
      line-height: 1.45;
    }

    [${ROW_ATTR}] span {
      max-width: 260px;
    }

    [${ROW_ATTR}] select {
      min-width: 92px;
      min-height: 38px;
      border: 1.5px solid #b76633;
      border-radius: 999px;
      background: #fffaf5;
      color: #2d3135;
      font-size: 13px;
      font-weight: 800;
      padding: 8px 12px;
      outline: none;
    }

    [${ROW_ATTR}] select:focus {
      box-shadow: 0 0 0 3px rgba(183, 102, 51, 0.16);
    }

    [data-homevalue-area-warning='true'] {
      margin-top: 8px;
      border: 1px solid #f5c4b3;
      border-radius: 14px;
      background: #fff3f0;
      color: #9a3412;
      font-size: 12px;
      line-height: 1.5;
      padding: 10px 12px;
    }

    [data-homevalue-area-warning='true'][hidden] {
      display: none !important;
    }

    @media (max-width: 767px) {
      [${ROW_ATTR}] {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      [${ROW_ATTR}] span {
        max-width: none;
      }

      [${ROW_ATTR}] select {
        width: 100%;
        min-height: 44px;
        font-size: 15px;
      }
    }
  `

  document.head.appendChild(style)
}

function attachField(input: HTMLInputElement, kind: AreaFieldKind): ManagedAreaField | null {
  if (input.getAttribute(ATTACHED_ATTR) === 'true') return null

  input.setAttribute(ATTACHED_ATTR, 'true')

  const row = document.createElement('div')
  row.setAttribute(ROW_ATTR, kind)

  const helper = document.createElement('span')
  helper.textContent = kind === 'land' || kind === 'builtUp'
    ? 'Choose sqft or sqm for this size.'
    : 'Choose sqft or sqm before entering your size.'

  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Area unit')
  select.innerHTML = '<option value="sqft">sqft</option><option value="sqm">sqm</option>'
  select.value = 'sqft'

  const warning = document.createElement('div')
  warning.setAttribute('data-homevalue-area-warning', 'true')
  warning.hidden = true

  row.appendChild(helper)
  row.appendChild(select)
  input.insertAdjacentElement('afterend', row)
  row.insertAdjacentElement('afterend', warning)

  const field = { input, row, select, warning, kind }

  input.addEventListener('input', () => updateFieldUi(field))
  select.addEventListener('change', () => updateFieldUi(field))
  updateFieldUi(field)

  return field
}

function isGenerateButton(button: HTMLButtonElement) {
  const text = normaliseText(button.textContent)
  if (text.includes('unlock') || text.includes('maybe later')) return false
  return text.includes('home value') || text.includes('property value') || text.includes('generate') || text.includes('calculate') || text.includes('estimate')
}

export default function HomeValueAreaUnitSelector() {
  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
    if (!TARGET_PATHS.has(currentPath)) return

    injectStyles()

    const managedFields = new Set<ManagedAreaField>()
    let replayingClick = false
    let scanTimer: number | null = null

    const removeField = (field: ManagedAreaField) => {
      field.input.removeAttribute(ATTACHED_ATTR)
      field.row.remove()
      field.warning.remove()
      managedFields.delete(field)
    }

    const scan = () => {
      cleanAreaLabelText()

      Array.from(managedFields).forEach((field) => {
        const currentKind = getAreaFieldKind(field.input)
        if (!currentKind || currentKind !== field.kind) removeField(field)
      })

      Array.from(document.querySelectorAll('input')).forEach((element) => {
        const input = element as HTMLInputElement
        const kind = getAreaFieldKind(input)
        if (!kind) return
        const field = attachField(input, kind)
        if (field) managedFields.add(field)
      })
    }

    const scheduleScan = () => {
      if (scanTimer) window.clearTimeout(scanTimer)
      scanTimer = window.setTimeout(scan, 80)
    }

    const convertSelectedSqmFields = () => {
      let didConvert = false
      managedFields.forEach((field) => {
        if (!document.body.contains(field.input)) return
        if (getAreaFieldKind(field.input) !== field.kind) return
        if (field.select.value !== 'sqm') return

        const sqftValue = convertSqmToSqft(field.input.value)
        if (!sqftValue) return

        setNativeInputValue(field.input, sqftValue)
        field.select.value = 'sqft'
        updateFieldUi(field)
        didConvert = true
      })
      return didConvert
    }

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest('button') as HTMLButtonElement | null
      if (button && isGenerateButton(button) && !replayingClick) {
        const didConvert = convertSelectedSqmFields()
        if (didConvert) {
          event.preventDefault()
          event.stopPropagation()
          replayingClick = true
          window.setTimeout(() => {
            button.click()
            replayingClick = false
          }, 0)
          return
        }
      }

      scheduleScan()
    }

    const handleChange = () => scheduleScan()
    const handleInput = () => scheduleScan()

    scan()
    document.addEventListener('click', handleClick, true)
    document.addEventListener('change', handleChange, true)
    document.addEventListener('input', handleInput, true)

    return () => {
      if (scanTimer) window.clearTimeout(scanTimer)
      document.removeEventListener('click', handleClick, true)
      document.removeEventListener('change', handleChange, true)
      document.removeEventListener('input', handleInput, true)
      managedFields.forEach((field) => {
        field.row.remove()
        field.warning.remove()
      })
    }
  }, [])

  return null
}

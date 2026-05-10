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
  row: HTMLDivElement
  helper: HTMLSpanElement
  wrapper: HTMLElement | null
}

function normaliseText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function getAssociatedFieldText(input: HTMLInputElement) {
  const id = input.id
  const labelByFor = id
    ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent
    : ''

  const previousText = input.previousElementSibling?.textContent || ''
  const labelText = input.closest('label')?.textContent || ''
  const ariaLabel = input.getAttribute('aria-label') || ''
  const name = input.getAttribute('name') || ''
  const placeholder = input.getAttribute('placeholder') || ''
  const parentText = input.parentElement?.textContent || ''

  return normaliseText(
    [labelByFor, previousText, labelText, ariaLabel, name, placeholder, parentText]
      .filter(Boolean)
      .join(' ')
  )
}

function getAreaFieldKind(input: HTMLInputElement): AreaFieldKind | null {
  const text = getAssociatedFieldText(input)

  if (text.includes('property type') || text.includes('tenure')) return null
  if (text.includes('floor level') || text.includes('stack number')) return null
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

function updateInputPlaceholder(field: ManagedAreaField) {
  field.input.placeholder = getPlaceholder(field.kind, field.unitSelect.value as AreaUnit)
}

function updateWarning(field: ManagedAreaField) {
  updateInputPlaceholder(field)

  if (!shouldWarn(field.input, field.unitSelect.value as AreaUnit)) {
    field.warning.style.display = 'none'
    field.warning.textContent = ''
    return
  }

  const label = field.kind === 'land' ? 'land size' : field.kind === 'builtUp' ? 'built-up size' : 'floor area'

  field.warning.style.display = 'block'
  field.warning.textContent = `This ${label} looks small for sqft. If your size is in sqm, change the unit to sqm.`
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

function injectResponsiveStyles() {
  if (document.getElementById('homevalue-area-unit-mobile-styles')) return

  const style = document.createElement('style')
  style.id = 'homevalue-area-unit-mobile-styles'
  style.textContent = `
    [data-homevalue-area-unit-row='standard'],
    [data-homevalue-area-unit-row='landed'] {
      box-sizing: border-box !important;
      width: 100% !important;
      grid-column: 1 / -1 !important;
    }

    [data-homevalue-area-unit-row='standard'] [data-homevalue-area-helper='true'],
    [data-homevalue-area-unit-row='landed'] [data-homevalue-area-helper='true'] {
      max-width: 240px !important;
    }

    @media (min-width: 768px) {
      [data-homevalue-area-unit-row='standard'],
      [data-homevalue-area-unit-row='landed'] {
        margin-top: 8px !important;
      }
    }

    @media (max-width: 767px) {
      [data-homevalue-landed-area-group='true'] {
        display: grid !important;
        grid-template-columns: 1fr !important;
        gap: 18px !important;
      }

      [data-homevalue-landed-area-wrapper='true'] {
        grid-column: 1 / -1 !important;
        width: 100% !important;
      }

      [data-homevalue-landed-shared-note='true'] {
        display: block !important;
        grid-column: 1 / -1 !important;
        margin: 2px 0 -4px !important;
        color: #5f666d !important;
        font-size: 13px !important;
        line-height: 1.45 !important;
      }

      [data-homevalue-area-unit-row='landed'] {
        display: block !important;
        margin-top: 10px !important;
      }

      [data-homevalue-area-unit-row='landed'] [data-homevalue-area-helper='true'] {
        display: none !important;
      }

      [data-homevalue-area-unit-row='landed'] select {
        width: 100% !important;
        min-height: 44px !important;
        font-size: 15px !important;
        padding: 10px 14px !important;
      }
    }
  `

  document.head.appendChild(style)
}

function findLikelyFieldWrapper(input: HTMLInputElement) {
  return input.closest('label') as HTMLElement | null || input.parentElement
}

function resetLandedMobileGroups() {
  document.querySelectorAll('[data-homevalue-landed-area-group="true"]').forEach((element) => {
    delete (element as HTMLElement).dataset.homevalueLandedAreaGroup
  })

  document.querySelectorAll('[data-homevalue-landed-area-wrapper="true"]').forEach((element) => {
    delete (element as HTMLElement).dataset.homevalueLandedAreaWrapper
  })

  document.querySelectorAll('[data-homevalue-landed-shared-note="true"]').forEach((element) => {
    element.remove()
  })
}

function markLandedMobileGroup(fields: Set<ManagedAreaField>) {
  resetLandedMobileGroups()

  const landedFields = Array.from(fields).filter((field) => field.kind === 'land' || field.kind === 'builtUp')
  if (landedFields.length === 0) return

  const wrappers = landedFields.map((field) => field.wrapper).filter(Boolean) as HTMLElement[]
  wrappers.forEach((wrapper) => {
    wrapper.dataset.homevalueLandedAreaWrapper = 'true'
  })

  const firstWrapper = wrappers[0]
  const commonParent = wrappers.find((wrapper) => wrapper.parentElement)?.parentElement
  if (!firstWrapper || !commonParent) return

  commonParent.dataset.homevalueLandedAreaGroup = 'true'

  if (commonParent.querySelector('[data-homevalue-landed-shared-note="true"]')) return

  const note = document.createElement('p')
  note.dataset.homevalueLandedSharedNote = 'true'
  note.textContent = 'Choose sqft or sqm for each size.'
  note.style.display = 'none'

  commonParent.insertBefore(note, firstWrapper)
}

function attachUnitSelector(input: HTMLInputElement, kind: AreaFieldKind): ManagedAreaField | null {
  if (input.dataset.homevalueAreaUnitAttached === 'true') return null
  if (input.type && !['text', 'number', 'tel'].includes(input.type)) return null

  input.dataset.homevalueAreaUnitAttached = 'true'

  const row = document.createElement('div')
  row.dataset.homevalueAreaUnitRow = kind === 'land' || kind === 'builtUp' ? 'landed' : 'standard'
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.justifyContent = 'space-between'
  row.style.gap = '12px'
  row.style.marginTop = '10px'
  row.style.fontSize = '12px'
  row.style.color = '#5f666d'

  const helper = document.createElement('span')
  helper.dataset.homevalueAreaHelper = 'true'
  helper.textContent = 'Select sqft or sqm before entering your size.'
  helper.style.lineHeight = '1.4'

  const select = document.createElement('select')
  select.value = 'sqft'
  select.setAttribute('aria-label', 'Area unit')
  select.style.minWidth = '86px'
  select.style.minHeight = '38px'
  select.style.border = '1.5px solid #b76633'
  select.style.borderRadius = '999px'
  select.style.background = '#fffaf5'
  select.style.color = '#2d3135'
  select.style.fontWeight = '800'
  select.style.fontSize = '13px'
  select.style.padding = '8px 12px'

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
  warning.style.gridColumn = '1 / -1'

  input.insertAdjacentElement('afterend', row)
  row.insertAdjacentElement('afterend', warning)

  const field: ManagedAreaField = {
    input,
    unitSelect: select,
    warning,
    kind,
    row,
    helper,
    wrapper: findLikelyFieldWrapper(input),
  }

  input.addEventListener('input', () => updateWarning(field))
  select.addEventListener('change', () => updateWarning(field))
  updateWarning(field)
  return field
}

export default function HomeValueAreaUnitSelector() {
  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
    if (!TARGET_PATHS.has(currentPath)) return

    injectResponsiveStyles()

    const managedFields = new Set<ManagedAreaField>()
    let replayingClick = false

    const scan = () => {
      cleanAreaLabelText()
      Array.from(document.querySelectorAll('input')).forEach((element) => {
        const input = element as HTMLInputElement
        const kind = getAreaFieldKind(input)
        if (!kind) return
        const field = attachUnitSelector(input, kind)
        if (field) managedFields.add(field)
      })
      markLandedMobileGroup(managedFields)
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
      resetLandedMobileGroups()
    }
  }, [])

  return null
}

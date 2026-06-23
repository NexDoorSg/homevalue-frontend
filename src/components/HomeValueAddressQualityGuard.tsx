'use client'

import { useEffect, useRef, useState } from 'react'

type PropertyCategory = 'hdb' | 'condo' | 'ec' | 'landed' | 'unknown'

type OneMapResult = {
  ADDRESS?: string
  BLK_NO?: string
  ROAD_NAME?: string
  BUILDING?: string
}

type AddressCheck = {
  value: string
  results: OneMapResult[]
}

const ROAD_WORDS = [
  'STREET',
  'ST',
  'ROAD',
  'RD',
  'AVENUE',
  'AVE',
  'DRIVE',
  'DR',
  'CLOSE',
  'CL',
  'LANE',
  'LINK',
  'CRESCENT',
  'CRES',
  'TERRACE',
  'TER',
  'PLACE',
  'PL',
  'WALK',
  'RISE',
  'VIEW',
  'GROVE',
  'JALAN',
  'JLN',
  'LORONG',
  'LOR',
]

function normalise(value: string) {
  return value.toUpperCase().replace(/\s+/g, ' ').trim()
}

function hasLeadingBlockOrHouseNumber(value: string) {
  return /^\d{1,4}[A-Z]?\s+/.test(normalise(value))
}

function buildingName(value: unknown) {
  const building = normalise(String(value || ''))
  if (!building || building === 'NIL' || building === 'NULL' || building === '-') return ''
  return building
}

function isRoadOnlyAddress(value: string) {
  const address = normalise(value)
  if (!address || hasLeadingBlockOrHouseNumber(address)) return false

  return ROAD_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(address))
}

function classifyPropertyCategory(root: ParentNode) {
  const selects = Array.from(root.querySelectorAll('select'))

  for (const select of selects) {
    const selectedOption = select.options[select.selectedIndex]
    const selectedText = normalise(
      `${selectedOption?.textContent || ''} ${selectedOption?.value || ''} ${select.value || ''}`
    )

    if (/\bHDB\b|\b2 ROOM\b|\b3 ROOM\b|\b4 ROOM\b|\b5 ROOM\b|\bEXECUTIVE\b/.test(selectedText)) {
      return 'hdb'
    }

    if (/\bEC\b|EXECUTIVE CONDO|EXECUTIVE CONDOMINIUM/.test(selectedText)) {
      return 'ec'
    }

    if (/TERRACE|SEMI|DETACHED|LANDED/.test(selectedText)) {
      return 'landed'
    }

    if (/CONDO|CONDOMINIUM|PENTHOUSE|BEDROOM/.test(selectedText)) {
      return 'condo'
    }
  }

  return 'unknown'
}

function findAddressInput(root: ParentNode) {
  const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[]

  const candidates = inputs.filter((input) => {
    const type = (input.type || 'text').toLowerCase()
    if (!['text', 'search', ''].includes(type)) return false

    const descriptor = normalise(
      `${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.getAttribute('aria-label') || ''}`
    )

    if (/NAME|PHONE|EMAIL|FLOOR|STACK|SIZE|SQFT|SQM|AREA|UNIT/.test(descriptor)) return false
    if (/ADDRESS|POSTAL|PROPERTY|STREET|ROAD|LOCATION/.test(descriptor)) return true

    const value = normalise(input.value || '')
    return ROAD_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(value))
  })

  return candidates[0] || null
}

function getNearestFormRoot(target: EventTarget | null) {
  const element = target instanceof Element ? target : null
  return element?.closest('form') || document
}

function getMessage(category: PropertyCategory) {
  if (category === 'hdb') {
    return 'Please select your full HDB block address, for example 698 Hougang Street 52, so we can estimate the correct block.'
  }

  if (category === 'condo' || category === 'ec') {
    return 'Please select the full condo or EC project/building result, not just the street name, so we can match the correct development.'
  }

  if (category === 'landed') {
    return 'Please enter the full landed house number and road name, for example 14 Chapel Close, so we can estimate the correct property.'
  }

  return 'Please select a more specific property address before continuing.'
}

function clearMessage(input: HTMLInputElement) {
  input.dataset.homevalueAddressInvalid = ''
  const existing = input.parentElement?.querySelector('[data-homevalue-address-error="true"]')
  existing?.remove()
}

function showMessage(input: HTMLInputElement, message: string) {
  input.dataset.homevalueAddressInvalid = 'true'
  input.focus()
  input.scrollIntoView({ behavior: 'smooth', block: 'center' })

  const existing = input.parentElement?.querySelector('[data-homevalue-address-error="true"]')
  if (existing) {
    existing.textContent = message
    return
  }

  const error = document.createElement('p')
  error.dataset.homevalueAddressError = 'true'
  error.textContent = message
  error.style.marginTop = '8px'
  error.style.fontSize = '13px'
  error.style.lineHeight = '1.5'
  error.style.color = '#b42318'
  input.insertAdjacentElement('afterend', error)
}

function hasValidBuildingResult(check: AddressCheck | null, address: string) {
  if (!check || normalise(check.value) !== normalise(address)) return false

  return check.results.some((result) => {
    const building = buildingName(result.BUILDING)
    if (!building) return false

    const resultAddress = normalise(result.ADDRESS || '')
    const inputAddress = normalise(address)

    return (
      building.includes(inputAddress) ||
      inputAddress.includes(building) ||
      resultAddress.includes(inputAddress) ||
      inputAddress.includes(resultAddress)
    )
  })
}

function hasValidHdbBlockResult(check: AddressCheck | null, address: string) {
  if (!check || normalise(check.value) !== normalise(address)) return false

  return check.results.some((result) => {
    const block = normalise(result.BLK_NO || '')
    if (!block) return false

    const inputAddress = normalise(address)
    const resultAddress = normalise(result.ADDRESS || '')
    const blockRoad = normalise(`${result.BLK_NO || ''} ${result.ROAD_NAME || ''}`)

    return (
      inputAddress.startsWith(`${block} `) ||
      resultAddress.includes(inputAddress) ||
      inputAddress.includes(blockRoad)
    )
  })
}

function validateAddress(category: PropertyCategory, address: string, check: AddressCheck | null) {
  const cleanedAddress = normalise(address)
  if (!cleanedAddress) return null

 if (category === 'hdb') {
    if (!hasLeadingBlockOrHouseNumber(cleanedAddress)) return getMessage(category)
    return null
}

  if (category === 'landed') {
    if (!hasLeadingBlockOrHouseNumber(cleanedAddress)) return getMessage(category)
    return null
  }

  if (category === 'condo' || category === 'ec') {
    if (isRoadOnlyAddress(cleanedAddress) && !hasValidBuildingResult(check, cleanedAddress)) {
      return getMessage(category)
    }
    return null
  }

  if (isRoadOnlyAddress(cleanedAddress) && !hasLeadingBlockOrHouseNumber(cleanedAddress)) {
    return getMessage(category)
  }

  return null
}

function shouldValidateClick(target: EventTarget | null) {
  const element = target instanceof Element ? target.closest('button, a, input[type="button"], input[type="submit"]') : null
  if (!element) return false

  const text = normalise(`${element.textContent || ''} ${(element as HTMLInputElement).value || ''}`)

  return /VALUE|VALUATION|ESTIMATE|CALCULATE|UNLOCK|REPORT|CONTINUE/.test(text)
}

export default function HomeValueAddressQualityGuard() {
  const [addressCheck, setAddressCheck] = useState<AddressCheck | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    function scheduleOneMapCheck(input: HTMLInputElement) {
      const value = normalise(input.value || '')
      clearMessage(input)

      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      abortRef.current?.abort()

      if (value.length < 4) {
        setAddressCheck(null)
        return
      }

      timeoutRef.current = setTimeout(async () => {
        const controller = new AbortController()
        abortRef.current = controller

        try {
          const response = await fetch(
            `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(
              value
            )}&returnGeom=Y&getAddrDetails=Y&pageNum=1`,
            { signal: controller.signal }
          )

          if (!response.ok) return

          const data = await response.json()
          setAddressCheck({
            value,
            results: Array.isArray(data?.results) ? data.results.slice(0, 20) : [],
          })
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            console.warn('HomeValue address quality check failed', error)
          }
        }
      }, 250)
    }

    function validateEvent(event: Event) {
      if (event.type === 'click' && !shouldValidateClick(event.target)) return

      const root = getNearestFormRoot(event.target)
      const addressInput = findAddressInput(root)
      if (!addressInput) return

      const category = classifyPropertyCategory(root)
      const message = validateAddress(category, addressInput.value, addressCheck)
      if (!message) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      showMessage(addressInput, message)
    }

    function handleInput(event: Event) {
      const root = getNearestFormRoot(event.target)
      const addressInput = findAddressInput(root)
      if (!addressInput || addressInput !== event.target) return
      scheduleOneMapCheck(addressInput)
    }

    document.addEventListener('input', handleInput, true)
    document.addEventListener('change', handleInput, true)
    document.addEventListener('click', validateEvent, true)
    document.addEventListener('submit', validateEvent, true)

    return () => {
      document.removeEventListener('input', handleInput, true)
      document.removeEventListener('change', handleInput, true)
      document.removeEventListener('click', validateEvent, true)
      document.removeEventListener('submit', validateEvent, true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      abortRef.current?.abort()
    }
  }, [addressCheck])

  return null
}

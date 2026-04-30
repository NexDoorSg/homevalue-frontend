'use client'

import { useEffect } from 'react'

const TARGET_PATHS = new Set(['/', '/free-property-valuation-singapore'])
const STANDARD_UNLOCK_CTA = 'Unlock Full Home Value'

function normaliseText(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const styles = window.getComputedStyle(element)

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    styles.display !== 'none' &&
    styles.visibility !== 'hidden' &&
    styles.opacity !== '0'
  )
}

function isUnlockResultText(text: string) {
  return (
    text === 'view full report' ||
    text === 'view my full report' ||
    text === 'unlock full report' ||
    text === 'unlock my full report' ||
    text === 'see full home value' ||
    text === 'see my full home value' ||
    text === 'unlock full home value' ||
    text === 'unlock my full home value'
  )
}

function isGenerateButtonText(text: string) {
  return (
    text === 'see my home value' ||
    text === 'get my home value' ||
    text.includes('generate') ||
    text.includes('calculate') ||
    text.includes('estimate my') ||
    text.includes('see my property value')
  )
}

function getButtons() {
  return Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
}

function hideMaybeLaterOptions() {
  const clickableElements = Array.from(document.querySelectorAll('button, a')) as HTMLElement[]

  clickableElements.forEach((element) => {
    const text = normaliseText(element.textContent)

    if (text === 'maybe later' || text === 'maybe later.') {
      element.style.display = 'none'
      element.setAttribute('aria-hidden', 'true')
      element.setAttribute('tabindex', '-1')
    }
  })
}

function standardiseUnlockButtons() {
  getButtons().forEach((button) => {
    const text = normaliseText(button.textContent)

    if (isUnlockResultText(text) && button.textContent?.trim() !== STANDARD_UNLOCK_CTA) {
      button.textContent = STANDARD_UNLOCK_CTA
    }
  })
}

function findUnlockResultButton() {
  return getButtons().find((button) => {
    if (button.disabled || !isVisible(button)) return false

    const text = normaliseText(button.textContent)
    return isUnlockResultText(text)
  })
}

export default function HomeValueLeadPopupExperiment() {
  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/'
    if (!TARGET_PATHS.has(currentPath)) return

    let hasAutoOpenedForCurrentResult = false
    let autoOpenTimer: number | null = null

    const clearAutoOpenTimer = () => {
      if (autoOpenTimer !== null) {
        window.clearTimeout(autoOpenTimer)
        autoOpenTimer = null
      }
    }

    const prepareLeadCaptureUi = () => {
      hideMaybeLaterOptions()
      standardiseUnlockButtons()
    }

    const scheduleAutoOpen = () => {
      prepareLeadCaptureUi()

      if (hasAutoOpenedForCurrentResult || autoOpenTimer !== null) return

      const unlockButton = findUnlockResultButton()
      if (!unlockButton) return

      autoOpenTimer = window.setTimeout(() => {
        autoOpenTimer = null
        prepareLeadCaptureUi()

        if (hasAutoOpenedForCurrentResult) return

        const latestUnlockButton = findUnlockResultButton()
        if (!latestUnlockButton) return

        hasAutoOpenedForCurrentResult = true
        latestUnlockButton.click()

        window.setTimeout(prepareLeadCaptureUi, 50)
        window.setTimeout(prepareLeadCaptureUi, 250)
        window.setTimeout(prepareLeadCaptureUi, 750)
      }, 900)
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const clickedButton = target?.closest('button') as HTMLButtonElement | null
      if (!clickedButton) return

      const text = normaliseText(clickedButton.textContent)

      if (isGenerateButtonText(text) && !isUnlockResultText(text)) {
        hasAutoOpenedForCurrentResult = false
        clearAutoOpenTimer()
      }
    }

    prepareLeadCaptureUi()
    scheduleAutoOpen()

    const observer = new MutationObserver(() => {
      prepareLeadCaptureUi()
      scheduleAutoOpen()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    document.addEventListener('click', handleClick, true)
    const interval = window.setInterval(scheduleAutoOpen, 500)

    return () => {
      clearAutoOpenTimer()
      observer.disconnect()
      document.removeEventListener('click', handleClick, true)
      window.clearInterval(interval)
    }
  }, [])

  return null
}

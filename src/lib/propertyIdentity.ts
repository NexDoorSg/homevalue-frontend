export type PropertyIdentityInput = {
  canonicalProjectName?: unknown
  oneMapBuilding?: unknown
  postalCode?: unknown
  address?: unknown
  unitNumber?: unknown
}

export type PropertyIdentityPayload = {
  project_name: string | null
  postal_code: string | null
  address: string | null
  unit_number: string | null
}

function normalizeProjectName(value: unknown) {
  if (typeof value !== 'string') return null

  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized || normalized.toUpperCase() === 'NIL') return null

  return normalized
}

function normalizePostalCode(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const normalized = String(value).replace(/\s+/g, ' ').trim()
  const match = normalized.match(/^(?:Singapore\s+)?(\d{6})$/i)

  return match?.[1] ?? null
}

function preserveNonBlankString(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

export function buildPropertyIdentityPayload({
  canonicalProjectName,
  oneMapBuilding,
  postalCode,
  address,
  unitNumber,
}: PropertyIdentityInput): PropertyIdentityPayload {
  return {
    project_name:
      normalizeProjectName(canonicalProjectName) ??
      normalizeProjectName(oneMapBuilding),
    postal_code: normalizePostalCode(postalCode),
    address: preserveNonBlankString(address),
    unit_number: preserveNonBlankString(unitNumber),
  }
}

export function buildLeadSyncPayload<T extends Record<string, unknown>>(
  leadPayload: T,
  propertyIdentity: PropertyIdentityInput
): T & PropertyIdentityPayload {
  return {
    ...leadPayload,
    ...buildPropertyIdentityPayload(propertyIdentity),
  }
}

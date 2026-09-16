interface NamedDeliverable {
  id?: number | string | null
  name?: string | null
}

export function normalizeDeliverableName(value: string | null | undefined) {
  return String(value || '').trim().toLocaleLowerCase()
}

export function hasDuplicateDeliverableName(
  items: NamedDeliverable[],
  candidate: string,
  excludedId?: number | string | null
) {
  const normalized = normalizeDeliverableName(candidate)
  if (!normalized) return false

  return items.some(item =>
    (excludedId === undefined || excludedId === null || String(item.id) !== String(excludedId))
    && normalizeDeliverableName(item.name) === normalized
  )
}

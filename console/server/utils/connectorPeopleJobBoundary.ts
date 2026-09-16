const peopleManagedScopes = new Set(['organization', 'people'])

export function isPeopleManagedConnectorJob(value: unknown) {
  if (!value || typeof value !== 'object') return false
  const scopes = (value as { objectScopes?: unknown }).objectScopes
  if (!Array.isArray(scopes)) return false
  const normalized = scopes.map(scope => String(scope).trim().toLowerCase())
  return normalized.includes('people')
    && normalized.length > 0
    && normalized.every(scope => peopleManagedScopes.has(scope))
}

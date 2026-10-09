import { createError } from 'h3'
import type { ManifestPermission } from './appManifestPermission.ts'

export interface ManifestDefaultScope extends ManifestPermission {
  scopeType: 'tenant' | 'subject'
  scopeValue: 'global' | 'self'
}

// Only these two default templates have a reviewed, object-independent compiler.
// supportedScopes advertises a vocabulary; it cannot invent default semantics.
const templates = new Map([
  ['tenant:global', { scopeType: 'tenant', scopeValue: 'global' }],
  ['subject:self', { scopeType: 'subject', scopeValue: 'self' }]
] as const)

/** undefined preserves existing defaults; [] explicitly removes owned defaults. */
export function parseManifestDefaultScopes(
  role: Record<string, unknown>,
  permissions: ManifestPermission[],
  supportedScopes: unknown
): ManifestDefaultScope[] | undefined {
  if (!Object.hasOwn(role, 'defaultScopes')) return undefined
  const invalid = () => createError({ statusCode: 400, message: `recommendedRoles[${String(role.code)}].defaultScopes is invalid or references an ungranted permission` })
  if (!Array.isArray(role.defaultScopes) || role.defaultScopes.length > 100) throw invalid()
  const supported = new Set(Array.isArray(supportedScopes) ? supportedScopes : [])
  const result = new Map<string, ManifestDefaultScope>()
  for (const entry of role.defaultScopes) {
    const record = typeof entry === 'string' ? { scope: entry } : entry
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw invalid()
    const scope = record as Record<string, unknown>
    if (Object.keys(scope).some(key => !['scope', 'resourceCode', 'action'].includes(key))) throw invalid()
    if (typeof scope.scope !== 'string' || !supported.has(scope.scope)) throw invalid()
    const template = templates.get(scope.scope as 'tenant:global' | 'subject:self')
    if (!template) throw invalid()
    for (const key of ['resourceCode', 'action']) {
      if (Object.hasOwn(scope, key) && (typeof scope[key] !== 'string' || !scope[key] || scope[key] === '*')) throw invalid()
    }
    if (Object.hasOwn(scope, 'action') && !Object.hasOwn(scope, 'resourceCode')) throw invalid()
    const matching = permissions.filter(permission => (!scope.resourceCode || scope.resourceCode === permission.resourceCode)
      && (!scope.action || scope.action === permission.action))
    if (!matching.length) throw invalid()
    for (const permission of matching) {
      const row = { ...permission, ...template }
      result.set(JSON.stringify(row), row)
    }
  }
  return [...result.values()]
}

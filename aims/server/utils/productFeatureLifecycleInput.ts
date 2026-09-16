import { productFeatureDeleteInput } from './productFeatureInput'

export function productFeatureLifecycleInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { target, evidence, ...identity } = raw as Record<string, unknown>
  const input = productFeatureDeleteInput(identity, bizId)
  if (!input || (target !== 'active' && target !== 'deprecated')) return null
  if (target === 'deprecated') return evidence === undefined || evidence === null ? { ...input, target, evidence: null } : null
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  const value = evidence as Record<string, unknown>
  if (Object.keys(value).some(key => !['kind', 'description', 'releaseBizId'].includes(key))) return null
  if (value.kind === 'legacy') {
    if (typeof value.description !== 'string' || !value.description.trim() || [...value.description].length > 10000 || value.description.includes('\0') || !value.description.isWellFormed() || value.releaseBizId !== undefined) return null
    return { ...input, target, evidence: { kind: 'legacy', description: value.description, release_biz_id: '' } }
  }
  if (value.kind === 'release' && value.description === undefined && typeof value.releaseBizId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.releaseBizId)) return { ...input, target, evidence: { kind: 'release', description: '', release_biz_id: value.releaseBizId } }
  return null
}

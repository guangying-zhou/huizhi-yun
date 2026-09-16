const UNTRUSTED_REVIEW_ACTOR_KEYS = [
  'current_user',
  'currentUser',
  'operator_uid',
  'operatorUid',
  'actor_uid',
  'actorUid'
]

/**
 * Rebuild review read context only after the BFF has authenticated the
 * browser session. The tenant-runtime signs this actor delegation; request
 * query parameters must never choose a different subject.
 */
export function withTrustedCodocsReviewReadContext(
  source: Record<string, unknown>,
  actorUid: string
) {
  const actor = String(actorUid || '').trim()
  if (!actor) throw new Error('trusted review read actor is required')

  const result: Record<string, unknown> = { ...source }
  for (const key of UNTRUSTED_REVIEW_ACTOR_KEYS) Reflect.deleteProperty(result, key)

  result.current_user = actor
  result.currentUser = actor
  result.operator_uid = actor
  result.operatorUid = actor
  result.actor_uid = actor
  result.actorUid = actor
  return result
}

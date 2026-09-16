import type { FoundationObjectContext } from '@hzy/foundation/server/utils/scopeEvaluator'

export interface ProductAuthorizationFacts {
  product_code: string
  actor_uid: string
  status: 'active' | 'archived'
  revision: number
  is_member: boolean
  is_manager: boolean
}

export function productAuthorizationObject(facts: ProductAuthorizationFacts, productCode: string, uid: string): FoundationObjectContext | null {
  if (!uid || !productCode || facts.actor_uid !== uid || facts.product_code !== productCode
    || typeof facts.is_member !== 'boolean' || typeof facts.is_manager !== 'boolean'
    || !['active', 'archived'].includes(facts.status)
    || !Number.isSafeInteger(facts.revision) || facts.revision < 1
    || (facts.is_manager && !facts.is_member)) return null
  return {
    actorUid: uid,
    productCode,
    productMemberUids: facts.is_member ? [uid] : [],
    productManagerUids: facts.is_manager ? [uid] : [],
    matchedRelations: [
      ...(facts.is_member ? ['product:member', 'relation:product_member'] : []),
      ...(facts.is_manager ? ['product:manager', 'relation:product_manager'] : [])
    ]
  }
}

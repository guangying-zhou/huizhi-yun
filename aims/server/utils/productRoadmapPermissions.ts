import { createError, type H3Event } from 'h3'
import { checkProductPermission, requireProductPermission } from './productAuthorization'

export async function productRoadmapPermissions(event: H3Event, code: string) {
  const facts = await requireProductPermission(event, code, 'product_roadmaps', 'view')
  const actions = ['edit', 'commit'] as const
  const decisions = await Promise.all(actions.map(action => checkProductPermission(event, code, 'product_roadmaps', action)))
  // Do not assemble a UI permission snapshot from different workspace versions.
  for (const decision of decisions) {
    const other = decision.facts
    if (other.product_code !== facts.product_code || other.actor_uid !== facts.actor_uid || other.status !== facts.status || other.revision !== facts.revision || other.is_member !== facts.is_member || other.is_manager !== facts.is_manager) {
      throw createError({ statusCode: 409, message: '产品授权上下文已变化，请刷新' })
    }
  }
  return { code: 0, data: { product_code: code, status: facts.status, revision: facts.revision, ...Object.fromEntries(actions.map((action, i) => [action, decisions[i]!.allowed])) } }
}

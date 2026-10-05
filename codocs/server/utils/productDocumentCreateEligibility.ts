import { createError, type H3Event } from 'h3'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

// Invoke only after validating the product-create service signature. actorUid
// is the signed user, never the service client or an unsigned browser field.
export async function requireProductDocumentCreateEligibility(event: H3Event, actorUid: string) {
  if (typeof actorUid !== 'string' || !actorUid || actorUid !== actorUid.trim() || !actorUid.isWellFormed() || [...actorUid].length > 64 || /[\p{Cc}]/u.test(actorUid)) throw createError({ statusCode: 403, message: '文档创建用户身份无效' })
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(actorUid, 'codocs', event)
  if (snapshot.uid !== actorUid) throw createError({ statusCode: 503, message: '文档创建授权身份不一致' })
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'create', snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: '当前用户无权创建文档' })
}

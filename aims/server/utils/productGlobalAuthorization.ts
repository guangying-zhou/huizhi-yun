import { createError, type H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { requireAimsSessionUid } from './authIdentity'
import { productGlobalOnboardDecision } from './productGlobalAuthorizationCore'

export async function checkProductOnboardPermission(event: H3Event) {
  const uid = await requireAimsSessionUid(event)
  const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', { resourceCode: 'products', action: 'onboard' })
  return { uid, allowed: productGlobalOnboardDecision(snapshot.grants, snapshot.actionPolicy).allowed }
}

export async function requireProductOnboardPermission(event: H3Event) {
  const { uid, allowed } = await checkProductOnboardPermission(event)
  if (!allowed) {
    throw createError({ statusCode: 403, message: '需要明确的全租户产品空间启用权限' })
  }
  return uid
}

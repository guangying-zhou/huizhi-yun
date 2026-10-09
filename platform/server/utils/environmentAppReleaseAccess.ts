import { createError, type H3Event } from 'h3'
import { hasOpsPermission } from './platformOpsRbac'

/** Recheck a fixed capability at the handler, independent of URL spelling. */
export async function requireEnvironmentAppReleaseAccess(event: H3Event, write = false) {
  const uid = String(event.context.platformUid || '')
  if (!await hasOpsPermission(uid, '/api/platform/ops/tenants/_/app-releases', write ? 'PUT' : 'GET')) {
    throw createError({ statusCode: 403, message: '没有环境应用版本操作权限' })
  }
}

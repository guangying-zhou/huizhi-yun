import { ok, requireString } from '~~/server/utils/api'
import { buildAuthorizationSnapshot } from '~~/server/utils/authorization'

function queryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim() || null
}

export default defineEventHandler(async (event) => {
  const uid = requireString(getRouterParam(event, 'uid'), 'uid')
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const appCode = queryValue(query.appCode)
  const activeRoleCode = queryValue(query.activeRoleCode)
  const authorizationMode = queryValue(query.authorizationMode)

  const snapshot = await buildAuthorizationSnapshot(tenantCode, uid, appCode, {
    activeRoleCode,
    authorizationMode
  })

  return ok(snapshot)
})

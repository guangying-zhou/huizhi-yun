import { ok, requireString } from '~~/server/utils/api'
import { checkPermission } from '~~/server/utils/authorization'

function bodyValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)

  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const uid = requireString(body.uid, 'uid')
  const appCode = requireString(body.appCode, 'appCode')
  const resourceCode = requireString(body.resourceCode, 'resourceCode')
  const action = requireString(body.action, 'action')
  const activeRoleCode = bodyValue(body.activeRoleCode)
  const authorizationMode = bodyValue(body.authorizationMode)

  const result = await checkPermission(tenantCode, uid, appCode, resourceCode, action, {
    activeRoleCode,
    authorizationMode
  })

  return ok({
    allowed: result.allowed,
    matchedAction: result.matchedAction,
    roles: result.roles,
    scopes: result.scopes
  })
})

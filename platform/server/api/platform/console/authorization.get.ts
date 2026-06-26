import { getQuery } from 'h3'
import { ok } from '~~/server/utils/api'
import { getTenantContextCode, parseBooleanLike, parseCsvSet, requireAuthenticated } from '~~/server/utils/access'
import { buildTenantAccountAuthorizationSnapshot } from '~~/server/utils/authorization'
import { buildOpsAuthorizationSnapshot } from '~~/server/utils/platformOpsRbac'
import { requireActiveTenantMembership } from '~~/server/utils/tenantAccounts'
import { TENANT_CONSOLE_APP_CODE } from '~~/server/utils/tenantConsole'

type ConsoleAuthorizationScope = 'admin' | 'dashboard'

function normalizeScope(value: unknown): ConsoleAuthorizationScope {
  return value === 'dashboard' ? 'dashboard' : 'admin'
}

function appendResourceAction(resources: Record<string, string[]>, resourceCode: string, action: string) {
  const actions = resources[resourceCode] || []
  if (!actions.includes(action)) {
    actions.push(action)
  }
  resources[resourceCode] = actions
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const scope = normalizeScope(query.scope)
  const runtimeConfig = useRuntimeConfig()
  const securityConfig = runtimeConfig.security || {}

  if (scope === 'dashboard') {
    const auth = await requireAuthenticated(event, { scope: 'tenant_admin' })
    const { uid } = auth
    const tenantFromQuery = String(query.tenantCode || '').trim()
    const { effectiveTenantCode } = getTenantContextCode(event)
    const tenantCode = tenantFromQuery || effectiveTenantCode

    if (!tenantCode) {
      return ok({
        uid,
        scope,
        tenantCode: '',
        roles: [],
        resources: {}
      })
    }

    const membership = await requireActiveTenantMembership(auth, tenantCode)
    const snapshot = await buildTenantAccountAuthorizationSnapshot(
      tenantCode,
      membership.account.accountId,
      uid,
      TENANT_CONSOLE_APP_CODE
    )
    const resources: Record<string, string[]> = {}

    for (const permission of snapshot.permissions) {
      appendResourceAction(resources, permission.resourceCode, permission.action)
    }

    return ok({
      uid,
      scope,
      tenantCode,
      roles: snapshot.roles.map(role => role.roleCode),
      resources
    })
  }

  const auth = await requireAuthenticated(event, { scope: 'platform_admin' })
  const { uid } = auth
  const opsAllowlist = parseCsvSet(securityConfig.opsUids)
  const bootstrapUids = parseCsvSet(securityConfig.opsBootstrapUids)
  const allowOpsUidFallback = parseBooleanLike(securityConfig.allowOpsUidFallback, true)
  const fallbackFullAccess = allowOpsUidFallback && opsAllowlist.has(uid)
  const snapshot = await buildOpsAuthorizationSnapshot(uid, {
    bootstrapUids: [...bootstrapUids],
    fallbackFullAccess
  })

  return ok({
    ...snapshot,
    scope,
    tenantCode: ''
  })
})

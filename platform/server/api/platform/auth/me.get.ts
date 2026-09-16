import { ok } from '~~/server/utils/api'
import { resolvePlatformSession, type PlatformSessionScope } from '~~/server/utils/platformAuth'

function normalizeScope(value: unknown): PlatformSessionScope | undefined {
  if (value === 'admin' || value === 'platform_admin') return 'platform_admin'
  if (value === 'dashboard' || value === 'tenant_admin') return 'tenant_admin'
  return undefined
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const session = await resolvePlatformSession(event, {
    scope: normalizeScope(query.scope)
  })

  if (!session) {
    return ok({
      authenticated: false,
      account: null,
      session: null
    })
  }

  return ok({
    authenticated: true,
    account: {
      uid: session.uid,
      username: session.username,
      email: session.email,
      displayName: session.displayName,
      accountType: session.accountType
    },
    session: {
      sessionUuid: session.sessionUuid,
      scope: session.sessionScope,
      tenantCode: session.tenantCode,
      expiresAt: session.expiresAt
    }
  })
})

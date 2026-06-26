import { ok } from '~~/server/utils/api'
import { revokePlatformSession, type PlatformSessionScope } from '~~/server/utils/platformAuth'

function normalizeScope(value: unknown): PlatformSessionScope | undefined {
  if (value === 'admin' || value === 'platform_admin') return 'platform_admin'
  if (value === 'dashboard' || value === 'tenant_admin') return 'tenant_admin'
  return undefined
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const body = await readBody<{ scope?: string } | null>(event).catch(() => null)
  await revokePlatformSession(event, {
    scope: normalizeScope(body?.scope || query.scope)
  })

  return ok({
    authenticated: false
  })
})

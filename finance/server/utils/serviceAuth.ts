import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'

export interface FinanceServiceAuthContext { authenticated?: boolean, reason?: string, tokenUse?: string, subjectType?: string, appCode?: string, clientCode?: string, scopes?: string[], claims?: { scope?: unknown } }

export interface FinanceServiceAuthRequirement {
  scope: string
  allowedApps: string[]
}

function sourceApp(auth: FinanceServiceAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

export function requireFinanceServiceCapability(auth: FinanceServiceAuthContext | undefined, requirement: FinanceServiceAuthRequirement) {
  if (!auth?.authenticated && auth?.reason === 'service_token_introspection_unavailable') {
    throw createError({ statusCode: 503, statusMessage: 'service_token_introspection_unavailable', message: 'Console service token introspection is unavailable.' })
  }
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') throw createError({ statusCode: 401, message: 'Console service token is required.' })
  const scopes = new Set([...(auth.scopes || []), ...String(auth.claims?.scope || '').split(/\s+/).filter(Boolean)])
  const hasRequiredScope = scopes.has(requirement.scope)
  if (!hasRequiredScope) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${requirement.scope}` })
  }
  const source = sourceApp(auth)
  if (!requirement.allowedApps.includes(source)) throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  return { sourceApp: source }
}

export function requireFinanceServiceAuth(auth: FinanceServiceAuthContext | undefined, scope: string) {
  return requireFinanceServiceCapability(auth, { scope, allowedApps: ['console'] })
}

export async function requireFinanceServiceScope(event: H3Event, scope: string) {
  const existing = event.context.consoleAuth as FinanceServiceAuthContext | undefined
  const auth = existing?.authenticated ? existing : await resolveConsoleAuthContext(event) as FinanceServiceAuthContext
  event.context.consoleAuth = auth
  requireFinanceServiceAuth(auth, scope)
}

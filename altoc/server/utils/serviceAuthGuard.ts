import { createError } from 'h3'

export interface AltocServiceAuthContext {
  authenticated?: boolean
  reason?: string
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
}

export interface AltocServiceAuthRequirement {
  scope: string
  allowedApps: string[]
}

export const AIMS_DELIVERY_RESULT_SERVICE_AUTH: AltocServiceAuthRequirement = {
  scope: 'altoc:service-ticket:delivery-result:sync',
  allowedApps: ['aims']
}

function sourceApp(auth: AltocServiceAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasServiceCapability(scopes: string[], required: string) {
  const scopeSet = new Set(scopes)
  if (scopeSet.has(required)) return true
  return scopeSet.has('altoc:*') || scopeSet.has('altoc:admin') || scopeSet.has('altoc.admin')
}

export function requireAltocServiceAuth(
  auth: AltocServiceAuthContext | null | undefined,
  requirement: AltocServiceAuthRequirement
) {
  if (!auth?.authenticated && auth?.reason === 'service_token_introspection_unavailable') {
    throw createError({
      statusCode: 503,
      statusMessage: 'service_token_introspection_unavailable',
      message: 'Console service token introspection is unavailable.'
    })
  }
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (!hasServiceCapability(auth.scopes || [], requirement.scope)) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${requirement.scope}` })
  }
  if (!requirement.allowedApps.includes(sourceApp(auth))) {
    throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  }
}

export async function runWithAltocServiceAuth<T>(
  auth: AltocServiceAuthContext | null | undefined,
  requirement: AltocServiceAuthRequirement,
  next: () => Promise<T> | T
) {
  requireAltocServiceAuth(auth, requirement)
  return await next()
}

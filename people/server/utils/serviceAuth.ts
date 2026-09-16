import { createError, type H3Event } from 'h3'
import { resolveConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'

export interface PeopleServiceAuthContext {
  authenticated?: boolean
  reason?: string
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
  claims?: { scope?: unknown }
}

function normalize(value: unknown) {
  return String(value || '').trim()
}

export function requirePeopleServiceAuth(auth: PeopleServiceAuthContext | undefined, options: { scope: string, allowedApps: string[] }) {
  if (!auth?.authenticated && auth?.reason === 'service_token_introspection_unavailable') {
    throw createError({ statusCode: 503, statusMessage: 'service_token_introspection_unavailable', message: 'Console service token introspection is unavailable.' })
  }
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') throw createError({ statusCode: 401, message: 'Console service token is required.' })
  const scopes = new Set([...(auth.scopes || []), ...normalize(auth.claims?.scope).split(/\s+/).filter(Boolean)])
  if (!scopes.has(options.scope)) throw createError({ statusCode: 403, message: `Missing required service scope: ${options.scope}` })
  const source = normalize(auth.appCode) || normalize(auth.clientCode).replace(/\.runtime$/, '')
  if (!options.allowedApps.includes(source)) throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  return { sourceApp: source }
}

async function resolveServiceAuth(event: H3Event) {
  const existing = event.context.consoleAuth as PeopleServiceAuthContext | undefined
  if (existing?.authenticated && existing.tokenUse === 'service') {
    return existing
  }

  const resolved = await resolveConsoleAuthContext(event) as PeopleServiceAuthContext
  event.context.consoleAuth = resolved
  return resolved
}

export async function requireServiceScope(event: H3Event, options: { scope: string, allowedApps: string[] }) {
  const auth = await resolveServiceAuth(event)
  return requirePeopleServiceAuth(auth, options)
}

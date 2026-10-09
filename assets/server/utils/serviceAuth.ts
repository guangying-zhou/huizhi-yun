import { createError, type H3Event } from 'h3'

interface ConsoleAuthContext {
  authenticated?: boolean
  reason?: string
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
}

function normalize(value: unknown) {
  return String(value || '').trim()
}

export function requireServiceScope(event: H3Event, options: { scope: string, allowedApps?: string[] }) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  if (!consoleAuth?.authenticated && consoleAuth?.reason === 'service_token_introspection_unavailable') {
    throw createError({ statusCode: 503, statusMessage: 'service_token_introspection_unavailable', message: 'Console service token introspection is unavailable.' })
  }
  if (!consoleAuth?.authenticated || consoleAuth.tokenUse !== 'service' || consoleAuth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }

  const scopes = Array.isArray(consoleAuth.scopes) ? consoleAuth.scopes : []
  if (!scopes.includes(options.scope)) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${options.scope}` })
  }

  const source = normalize(consoleAuth.appCode) || normalize(consoleAuth.clientCode).replace(/\.runtime$/, '')
  if (!source || (options.allowedApps && !options.allowedApps.includes(source))) {
    throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  }

  return { sourceApp: source }
}

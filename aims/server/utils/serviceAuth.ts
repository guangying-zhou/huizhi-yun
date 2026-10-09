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

function rejectServiceScope(
  consoleAuth: ConsoleAuthContext | undefined,
  options: { scope: string, allowedApps?: string[] },
  reason: string,
  statusCode: 401 | 403 | 503,
  message: string
): never {
  console.warn('[aims-service-auth] service capability rejected', {
    reason,
    requiredScope: options.scope,
    allowedApps: options.allowedApps || [],
    tokenUse: normalize(consoleAuth?.tokenUse),
    subjectType: normalize(consoleAuth?.subjectType),
    sourceApp: normalize(consoleAuth?.appCode),
    clientCode: normalize(consoleAuth?.clientCode),
    scopes: Array.isArray(consoleAuth?.scopes) ? consoleAuth.scopes : []
  })
  throw createError({
    statusCode,
    ...(statusCode === 503 ? { statusMessage: 'service_token_introspection_unavailable' } : {}),
    message
  })
}

export function requireServiceScope(event: H3Event, options: { scope: string, allowedApps?: string[] }) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  if (!consoleAuth?.authenticated && consoleAuth?.reason === 'service_token_introspection_unavailable') {
    rejectServiceScope(consoleAuth, options, 'introspection_unavailable', 503, 'Console service token introspection is unavailable.')
  }
  if (!consoleAuth?.authenticated || consoleAuth.tokenUse !== 'service' || consoleAuth.subjectType !== 'service') {
    rejectServiceScope(consoleAuth, options, 'service_identity_required', 401, 'Console service token is required.')
  }

  const scopes = Array.isArray(consoleAuth.scopes) ? consoleAuth.scopes : []
  if (!scopes.includes(options.scope)) {
    rejectServiceScope(consoleAuth, options, 'required_scope_missing', 403, `Missing required service scope: ${options.scope}`)
  }

  const source = normalize(consoleAuth.appCode) || normalize(consoleAuth.clientCode).replace(/\.runtime$/, '')
  if (!source) {
    rejectServiceScope(consoleAuth, options, 'source_identity_incomplete', 403, 'Service caller identity is incomplete.')
  }
  if (options.allowedApps && !options.allowedApps.includes(source)) {
    rejectServiceScope(consoleAuth, options, 'source_app_not_allowed', 403, 'Service caller is not allowed for this endpoint.')
  }

  return { sourceApp: source }
}

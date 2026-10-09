import { createError, getHeader, type H3Event } from 'h3'
import {
  consumeConsoleBootstrapAccessKey,
  consumeConsoleRuntimeAppIdentity,
  consumeConsoleServiceClientCredential,
  type ConsoleServiceClientTokenSubject
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { isTrustedTenantGatewayRequest } from '~~/server/utils/platformRuntime'

export type ServiceClientTokenSubject = ConsoleServiceClientTokenSubject

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export async function consumeServiceClientCredentials(input: {
  event: H3Event
  clientId: unknown
  clientSecret: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  const clientId = stringValue(input.clientId)
  const clientSecret = stringValue(input.clientSecret)
  const audience = stringValue(input.audience)
  if (!clientId || !clientSecret) {
    throw createError({ statusCode: 401, message: 'invalid_client: client_id and client_secret are required' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }
  return (await consumeConsoleServiceClientCredential(input.event, {
    clientId,
    clientSecret,
    audience,
    scope: stringValue(input.scope) || undefined
  })).data
}

export async function consumeRuntimeAppIdentity(input: {
  event: H3Event
  appCode: unknown
  clientId?: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  if (!isTrustedTenantGatewayRequest(input.event)) {
    throw createError({ statusCode: 401, message: 'invalid_client: trusted runtime app identity is required' })
  }
  const headerAppCode = stringValue(getHeader(input.event, 'x-hzy-app-code'))
  const requestedAppCode = stringValue(input.appCode)
  const audience = stringValue(input.audience)
  if (!headerAppCode) {
    throw createError({ statusCode: 401, message: 'invalid_client: runtime app code is required' })
  }
  if (requestedAppCode && requestedAppCode !== headerAppCode) {
    throw createError({ statusCode: 403, message: 'invalid_client: runtime app code mismatch' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }
  return (await consumeConsoleRuntimeAppIdentity(input.event, {
    appCode: headerAppCode,
    clientId: stringValue(input.clientId) || undefined,
    audience,
    scope: stringValue(input.scope) || undefined
  })).data
}

export async function consumeBootstrapAccessKey(input: {
  event: H3Event
  appCode: unknown
  deploymentCode: unknown
  accessKey: unknown
  audience: unknown
  scope?: unknown
}): Promise<ServiceClientTokenSubject> {
  const appCode = stringValue(input.appCode)
  const deploymentCode = stringValue(input.deploymentCode)
  const accessKey = stringValue(input.accessKey)
  const audience = stringValue(input.audience)
  if (!appCode || !deploymentCode) {
    throw createError({ statusCode: 401, message: 'invalid_bootstrap: appCode and deploymentCode are required' })
  }
  if (!accessKey) {
    throw createError({ statusCode: 401, message: 'invalid_bootstrap: accessKey is required' })
  }
  if (!audience) {
    throw createError({ statusCode: 400, message: 'invalid_request: audience is required' })
  }
  return (await consumeConsoleBootstrapAccessKey(input.event, {
    appCode,
    deploymentCode,
    accessKey,
    audience,
    scope: stringValue(input.scope) || undefined
  })).data
}

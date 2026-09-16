import { getHeader, readBody, readRawBody, setHeader, type H3Event } from 'h3'
import { sanitizeServiceOperationErrorSummary } from '@hzy/foundation/server/utils/serviceOperation'
import { verifyActiveServiceAccessToken } from '~~/server/utils/oidc'
import { resolveServiceTokenIntrospectionFailure } from '~~/server/utils/serviceTokenStatus'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

async function readToken(event: H3Event) {
  const contentType = stringValue(getHeader(event, 'content-type')).toLowerCase()
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const raw = await readRawBody(event, 'utf8')
    return stringValue(new URLSearchParams(raw || '').get('token'))
  }
  const body: Record<string, unknown> = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  return stringValue(body.token)
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const token = await readToken(event)
  if (!token) return { active: false }

  try {
    const payload = await verifyActiveServiceAccessToken(event, token)
    return {
      active: true,
      token_use: 'service',
      client_id: stringValue(payload.client_id),
      scope: stringValue(payload.scope),
      exp: typeof payload.exp === 'number' ? payload.exp : undefined
    }
  } catch (error) {
    const failure = error as {
      statusCode?: unknown
      status?: unknown
      message?: unknown
      data?: { code?: unknown, upstreamStatus?: unknown }
    }
    console.warn('[console-oauth] service token introspection verification failed', {
      statusCode: Number(failure.statusCode || failure.status || 0),
      code: stringValue(failure.data?.code),
      upstreamStatus: Number(failure.data?.upstreamStatus || 0),
      summary: sanitizeServiceOperationErrorSummary(failure.message, 160)
    })
    return resolveServiceTokenIntrospectionFailure(error)
  }
})

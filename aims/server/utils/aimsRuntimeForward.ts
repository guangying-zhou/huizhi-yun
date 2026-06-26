import { createError, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

function runtimeEnvelopeError(envelope: RuntimeEnvelope<unknown>) {
  const data = envelope.data as {
    upstreamStatus?: number
    statusCode?: number
    status?: number
    code?: string | number
    message?: string
    error?: { code?: string | number, message?: string }
  } | undefined
  const statusCode = Number(data?.upstreamStatus || data?.statusCode || data?.status || 502)
  const code = data?.error?.code || data?.code || envelope.code
  const message = data?.error?.message || data?.message || envelope.message || 'Aims tenant-runtime returned an error.'
  return createError({
    statusCode,
    message,
    data: {
      code,
      message,
      upstreamStatus: statusCode
    }
  })
}

/**
 * 把 Nuxt-only 业务动作转发到 Aims tenant-runtime 专用端点。
 *
 * Aims 已迁移到 tenant-runtime/data-runtime，本地 handler 只负责鉴权上下文与转发；
 * runtime 未启用时显式 503，不允许回退本地 DB。
 */
export async function forwardAimsRuntimePost<T>(
  event: H3Event,
  path: string,
  options: { uid: string, body?: Record<string, unknown>, method?: 'POST' | 'PUT', query?: Record<string, unknown> }
): Promise<T> {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: 'aims.write',
    method: options.method || 'POST',
    query: { ...(options.query || {}), current_user: options.uid },
    body: { ...(options.body || {}), current_user: options.uid }
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for this operation.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw runtimeEnvelopeError(envelope)
  }
  return envelope.data as T
}

/** GET 形式的 runtime 转发（语义同 forwardAimsRuntimePost）。 */
export async function forwardAimsRuntimeGet<T>(
  event: H3Event,
  path: string,
  options: { uid: string, query?: Record<string, unknown> }
): Promise<T> {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'aims',
    scope: 'aims.read',
    method: 'GET',
    query: { ...(options.query || {}), current_user: options.uid }
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'Aims tenant-runtime is required for this operation.'
    })
  }

  const envelope = runtime.data
  if (envelope.code !== undefined && envelope.code !== 0) {
    throw runtimeEnvelopeError(envelope)
  }
  return envelope.data as T
}
